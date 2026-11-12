#!/usr/bin/env python3
"""YouTube Shorts 制作・投稿・集計の入口（日本語の運用CLI）。

  python3 sk.py status                       全作品の工程と「次の1コマンド」
  python3 sk.py build    <ep>                Blenderシーン生成（.blend 保存）
  python3 sk.py verify   <ep>                3D投影と解析値の照合（科学監修）
  python3 sk.py preview  <ep>                低解像度レンダー＋通し映像＋代表フレーム
  python3 sk.py render   <ep>                本番レンダー（カット単位・欠けたフレームから再開）
  python3 sk.py tts      <ep>                ローカルVOICEVOXでナレーション（あれば）
  python3 sk.py compose  <ep>                本番合成→MP4・字幕・サムネイル
  python3 sk.py qc       <ep>                ffprobe等で品質確認
  python3 sk.py publish  <ep> [--mode local|private|schedule] [--dry-run]
  python3 sk.py analytics [--report]         公開後24時間/7日の数値を記録・比較
  python3 sk.py auth                         （手元PCで）YouTube OAuth 認証

制作ジョブ（production）と投稿ジョブ（publish）・集計（analytics）は state.json の別セクションで管理し、
それぞれ単独で再開できる。重い処理はすべてスクリプトで再実行可能（Claude の呼び出しは不要）。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
VENV_PY = str(ROOT.parent / ".venv" / "bin" / "python")
EPS = ROOT / "episodes"
STATE_DIR = ROOT / "state"
JST = ZoneInfo("Asia/Tokyo")
STAGES = ["build", "verify", "preview", "render", "compose", "qc"]


def cfg():
    return tomllib.loads((ROOT / "config" / "channel.toml").read_text())


def now():
    return dt.datetime.now(tz=JST)


def ep_dir(ep):
    cands = [p for p in EPS.iterdir() if p.is_dir() and (p.name == ep or p.name.startswith(ep))]
    if len(cands) != 1:
        sys.exit(f"作品が特定できません: {ep} → {[p.name for p in cands]}")
    return cands[0]


def load_state(d: Path):
    p = d / "state.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"id": d.name, "production": {}, "publish": {"status": "not_uploaded", "history": []}, "analytics": {}}


def save_state(d: Path, st):
    st["updated_at"] = now().isoformat(timespec="seconds")
    st["next_command"] = next_command(d, st)
    (d / "state.json").write_text(json.dumps(st, ensure_ascii=False, indent=2))
    write_todo()


def mark(d, st, stage, ok=True, **info):
    st["production"][stage] = {"ok": ok, "at": now().isoformat(timespec="seconds"), **info}
    save_state(d, st)


def next_command(d, st):
    for s in STAGES:
        if not st["production"].get(s, {}).get("ok"):
            return f"python3 sk.py {s} {d.name}"
    ps = st["publish"]["status"]
    mode = cfg()["publish"]["mode"]
    if mode == "local":
        return "（制作完了。投稿するには config/channel.toml の mode と channel_id を設定し python3 sk.py publish " + d.name + "）"
    if ps in ("not_uploaded", "blocked", "uploading", "thumbnail_pending"):
        return f"python3 sk.py publish {d.name}"
    return "python3 sk.py analytics"


def write_todo():
    lines = ["# 未処理の工程と次のコマンド（自動生成: python3 sk.py status）", ""]
    for d in sorted(p for p in EPS.iterdir() if (p / "episode.json").exists()):
        st = load_state(d) if (d / "state.json").exists() else {"production": {}, "publish": {"status": "not_uploaded"}}
        done = [s for s in STAGES if st["production"].get(s, {}).get("ok")]
        todo = [s for s in STAGES if s not in done]
        lines += [f"## {d.name}", f"- 制作: 済 {done or 'なし'} / 未 {todo or 'なし'}",
                  f"- 投稿: {st['publish'].get('status')}" + (f"（{st['publish'].get('reason')}）" if st['publish'].get('reason') else ""),
                  f"- 次: `{st.get('next_command') or next_command(d, st)}`", ""]
    STATE_DIR.mkdir(exist_ok=True)
    (STATE_DIR / "TODO.md").write_text("\n".join(lines), encoding="utf-8")


def sh(cmd, **kw):
    print("$", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT, **kw)


def sha256(p: Path):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ------------------------------------------------------------------ 制作
def cmd_build(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    r = sh([VENV_PY, str(d / "scene.py")])
    mark(d, st, "build", r.returncode == 0, blend=str((d / "build").relative_to(ROOT)))


def cmd_verify(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    r = sh([VENV_PY, str(d / "verify_projection.py")], capture_output=True, text=True)
    vp = d / "build" / "verify" / "verify.json"
    res = json.loads(vp.read_text()) if vp.exists() else {}
    (d / "verify_result.json").write_text(json.dumps(res, ensure_ascii=False, indent=2))
    print(json.dumps(res, ensure_ascii=False, indent=2))
    mark(d, st, "verify", bool(res.get("pass")))


def cmd_preview(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    r1 = sh([VENV_PY, "lib/render_cuts.py", str(d), "preview", "--step", str(a.step)])
    r2 = sh([VENV_PY, str(d / "edit.py"), "preview"])
    r3 = sh([VENV_PY, str(d / "edit.py"), "stills", "--prefer", "preview"])
    mark(d, st, "preview", r1.returncode == 0 and r2.returncode == 0 and r3.returncode == 0)


def cmd_render(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    script = d / "render_final.sh"
    r = sh(["bash", str(script)] if script.exists() else [VENV_PY, "lib/render_cuts.py", str(d), "final"])
    mark(d, st, "render", r.returncode == 0)


def cmd_tts(a):
    d = ep_dir(a.ep)
    r = sh([sys.executable, "lib/tts_voicevox.py", str(d)])
    print("ナレーションあり" if r.returncode == 0 else "ナレーションなし（字幕＋BGM/効果音で制作）")


def cmd_compose(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    r = sh([VENV_PY, str(d / "edit.py"), "final"])
    r2 = sh([VENV_PY, str(d / "edit.py"), "stills", "--prefer", "final"])
    mark(d, st, "compose", r.returncode == 0 and r2.returncode == 0)


def cmd_qc(a):
    d = ep_dir(a.ep)
    st = load_state(d)
    out = d / "output"
    mp4 = out / f"{d.name.split('-')[0]}.mp4"
    r = sh([sys.executable, "lib/qc.py", str(mp4), "--srt", str(out / f"{d.name.split('-')[0]}.ja.srt"),
            "--stills", str(out / "stills"), "--out", str(out / "qc.json")], capture_output=True, text=True)
    res = json.loads((out / "qc.json").read_text())
    print(json.dumps({k: v for k, v in res["checks"].items()}, ensure_ascii=False, indent=1))
    mark(d, st, "qc", bool(res.get("pass")), sha256=sha256(mp4), file=str(mp4.relative_to(ROOT)))


# ------------------------------------------------------------------ 投稿
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def taken_slots(exclude_ep=None):
    out = set()
    for d in EPS.iterdir():
        if d.name == exclude_ep or not (d / "state.json").exists():
            continue
        p = load_state(d)["publish"]
        if p.get("publish_at") and p.get("status") in ("scheduled", "published"):
            out.add(p["publish_at"])
    return out


def next_slot(exclude_ep=None):
    c = cfg()["publish"]
    lead = dt.timedelta(hours=c.get("min_lead_hours", 3))
    taken = taken_slots(exclude_ep)
    base = now()
    for day in range(0, 35):
        day_d = (base + dt.timedelta(days=day)).date()
        for s in c["slots"]:
            if WEEKDAYS[day_d.weekday()] != s["weekday"]:
                continue
            hh, mm = (int(x) for x in s["time"].split(":"))
            t = dt.datetime(day_d.year, day_d.month, day_d.day, hh, mm, tzinfo=JST)
            if t >= base + lead and t.isoformat() not in taken:
                return t
    return None


def gate(d, st, meta, mode):
    """公開対象の確認。欠けている情報があれば理由のリストを返す（空なら通過）。"""
    reasons = []
    if not st["production"].get("qc", {}).get("ok"):
        reasons.append("品質確認(qc)が未通過")
    mp4 = ROOT / st["production"].get("qc", {}).get("file", "missing")
    if not mp4.exists():
        reasons.append("完成MP4がない")
    elif sha256(mp4) != st["production"]["qc"].get("sha256"):
        reasons.append("MP4がqc後に変更された（qcを再実行）")
    rights = json.loads((d / "rights.json").read_text()) if (d / "rights.json").exists() else None
    if not rights or any(x.get("status") != "ok" for x in rights["items"]):
        reasons.append("素材権利の確認が未完了（rights.json）")
    for k in ("title", "description"):
        if not meta.get(k):
            reasons.append(f"metadata.{k} がない")
    if len(meta.get("title", "")) > 100:
        reasons.append("タイトルが100文字超")
    if meta.get("made_for_kids") is None:
        reasons.append("視聴者設定(made_for_kids)が未決定")
    if meta.get("ai_disclosure", {}).get("contains_synthetic_media") is None:
        reasons.append("AI開示(containsSyntheticMedia)の判断が未記録")
    c = cfg()
    if not c["channel"].get("channel_id"):
        reasons.append("投稿先チャンネルIDが未設定（config/channel.toml）")
    if mode == "schedule" and c["publish"]["mode"] != "schedule":
        reasons.append("公開予約モードが設定で有効になっていない")
    return reasons


def cmd_publish(a):
    sys.path.insert(0, str(ROOT / "youtube"))
    d = ep_dir(a.ep)
    st = load_state(d)
    pub = st["publish"]
    meta = json.loads((d / "metadata.json").read_text())
    mode = a.mode or cfg()["publish"]["mode"]
    if mode == "local":
        print("mode=local：制作のみ。投稿は行いません。")
        pub.update(status=pub.get("status", "not_uploaded"), reason="mode=local")
        save_state(d, st)
        return
    if pub.get("status") in ("scheduled", "published", "uploaded_private") and pub.get("video_id") and pub.get("thumbnail") == "ok":
        print("投稿済み:", pub["status"], pub["video_id"], pub.get("publish_at"))
        return
    reasons = gate(d, st, meta, mode)
    if reasons:
        pub.update(status="blocked", reason=" / ".join(reasons))
        pub["history"].append({"at": now().isoformat(timespec="seconds"), "event": "blocked", "reasons": reasons})
        save_state(d, st)
        print("保留:", *reasons, sep="\n- ")
        return
    import yt
    try:
        ch = yt.my_channel()
    except yt.NotConfigured as e:
        pub.update(status="blocked", reason=str(e))
        save_state(d, st)
        print("保留:", e)
        return
    if ch["id"] != cfg()["channel"]["channel_id"]:
        pub.update(status="blocked", reason=f"認証チャンネル({ch['id']})が設定のchannel_idと不一致")
        save_state(d, st)
        print("保留:", pub["reason"])
        return
    mp4 = ROOT / st["production"]["qc"]["file"]
    size = mp4.stat().st_size
    sess_file = yt.SECRET_DIR / "sessions" / f"{d.name}.json"

    # --- 1) アップロード（未完了なら再開、成否不明なら照合）
    if not pub.get("video_id"):
        publish_at = None
        if mode == "schedule":
            slot = dt.datetime.fromisoformat(pub["planned_slot"]) if pub.get("planned_slot") else None
            if slot is None or slot < now() + dt.timedelta(hours=cfg()["publish"].get("min_lead_hours", 3)) \
                    or slot.isoformat() in taken_slots(d.name):
                slot = next_slot(d.name)
            if slot is None:
                pub.update(status="blocked", reason="空いている予約枠がない")
                save_state(d, st)
                return
            pub["planned_slot"] = slot.isoformat()
            publish_at = slot.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = {
            "snippet": {"title": meta["title"], "description": meta["description"], "tags": meta.get("tags", []),
                        "categoryId": cfg()["publish"]["category_id"], "defaultLanguage": "ja",
                        "defaultAudioLanguage": "ja"},
            "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": bool(meta["made_for_kids"]),
                       "containsSyntheticMedia": bool(meta["ai_disclosure"]["contains_synthetic_media"]),
                       "license": "youtube", "embeddable": True},
        }
        if publish_at:
            body["status"]["publishAt"] = publish_at
        if a.dry_run:
            print("DRY RUN", json.dumps(body, ensure_ascii=False, indent=1))
            return
        video = None
        if pub.get("status") == "uploading" and sess_file.exists():
            sess = json.loads(sess_file.read_text())
            if sess.get("sha256") != st["production"]["qc"]["sha256"]:
                sys.exit("保存済みセッションのファイルと現在のMP4が違います。手動確認してください")
            state_, val = yt.session_status(sess["url"], size)
            if state_ == "done":
                video = val
            elif state_ == "partial":
                video = yt.upload_from(sess["url"], mp4, val)
            else:
                ups = yt.recent_uploads(ch["uploads"])
                hit = [u for u in ups if u["title"] == meta["title"]]
                if hit and not a.force_new_upload:
                    video = {"id": hit[0]["video_id"]}
                    pub["history"].append({"at": now().isoformat(timespec="seconds"), "event": "reconciled_by_title"})
                elif not a.force_new_upload:
                    pub.update(status="blocked", reason="アップロード成否が不明。Studioで確認後 --force-new-upload で再実行")
                    save_state(d, st)
                    print("保留:", pub["reason"])
                    return
        if video is None:
            url = yt.start_session(body, size, cfg()["publish"].get("notify_subscribers", True))
            yt._secure_write(sess_file, json.dumps({"url": url, "sha256": st["production"]["qc"]["sha256"]}))
            pub.update(status="uploading", reason="", sha256=st["production"]["qc"]["sha256"])
            save_state(d, st)
            video = yt.upload_from(url, mp4, 0)
        pub.update(video_id=video["id"], status="uploaded_private")
        pub["history"].append({"at": now().isoformat(timespec="seconds"), "event": "uploaded", "video_id": video["id"]})
        save_state(d, st)
        if sess_file.exists():
            sess_file.unlink()

    # --- 2) 読み戻し（公開状態・予約日時・処理状況）
    v = yt.get_video(pub["video_id"])
    if not v:
        pub.update(status="blocked", reason="動画IDをAPIで読み戻せない")
        save_state(d, st)
        return
    s = v["status"]
    pub["readback"] = {"privacyStatus": s.get("privacyStatus"), "publishAt": s.get("publishAt"),
                       "uploadStatus": s.get("uploadStatus"),
                       "processing": v.get("processingDetails", {}).get("processingStatus")}
    if s.get("publishAt"):
        pub["publish_at"] = dt.datetime.fromisoformat(s["publishAt"].replace("Z", "+00:00")).astimezone(JST).isoformat()
        pub["status"] = "scheduled" if s.get("privacyStatus") == "private" else "published"
    elif s.get("privacyStatus") == "public":
        pub["status"] = "published"
    if mode == "schedule" and not s.get("publishAt") and pub["status"] != "published":
        pub["reason"] = "予約日時が読み戻せない（Studioで確認）"
    save_state(d, st)

    # --- 3) サムネイル（処理完了後のみ。失敗しても本体は再アップロードしない）
    if pub.get("thumbnail") != "ok":
        if pub["readback"]["processing"] != "succeeded":
            pub["thumbnail"] = "pending_processing"
            print("処理中のためサムネイルは後で設定します。再実行:", f"python3 sk.py publish {d.name}")
        else:
            thumb = d / "output" / "thumbnail_1080x1920.jpg"
            try:
                yt.set_thumbnail(pub["video_id"], thumb)
                pub["thumbnail"] = "ok"
            except Exception as e:  # noqa: BLE001
                pub["thumbnail"] = "failed"
                pub["history"].append({"at": now().isoformat(timespec="seconds"), "event": "thumbnail_failed",
                                       "error": str(e)[:300]})
                print("サムネイル設定失敗（本体はそのまま）:", str(e)[:200],
                      "\n代替: YouTubeアプリのShorts編集でサムネイルフレームを選ぶ")
        save_state(d, st)
    srt = d / "output" / f"{d.name.split('-')[0]}.ja.srt"
    if pub.get("caption") != "ok" and srt.exists():
        try:
            yt.set_caption(pub["video_id"], srt)
            pub["caption"] = "ok"
        except Exception as e:  # noqa: BLE001
            pub["caption"] = "failed: " + str(e)[:200]
        save_state(d, st)
    print(json.dumps({k: pub.get(k) for k in ("status", "video_id", "publish_at", "readback", "thumbnail", "caption")},
                     ensure_ascii=False, indent=1))


# ------------------------------------------------------------------ 集計
CHECKPOINTS = {"24h": dt.timedelta(hours=24), "7d": dt.timedelta(days=7)}
METRICS = ["views", "engagedViews", "averageViewDuration", "averageViewPercentage", "subscribersGained",
           "likes", "comments", "shares"]
CSV_COLS = ["recorded_at", "episode", "video_id", "checkpoint", "hours_since_publish", "public_view_count"] + METRICS + \
    ["studio_stayed_to_watch_pct", "studio_notes", "data_status"]


def cmd_analytics(a):
    csvp = STATE_DIR / "analytics.csv"
    STATE_DIR.mkdir(exist_ok=True)
    if not csvp.exists():
        csvp.write_text(",".join(CSV_COLS) + "\n", encoding="utf-8")
    if a.report:
        import csv
        rows = list(csv.DictReader(open(csvp, encoding="utf-8")))
        for cp in CHECKPOINTS:
            print(f"== {cp} 時点（公開から同じ経過時間で比較）")
            for r in rows:
                if r["checkpoint"] == cp:
                    print(f"  {r['episode']:<22} 公開再生 {r['public_view_count'] or '未取得':>8}  "
                          f"エンゲージ {r['engagedViews'] or '未取得':>8}  平均再生率 {r['averageViewPercentage'] or '未取得':>6}  "
                          f"継続率(Studio) {r['studio_stayed_to_watch_pct'] or '未記入'}  登録 {r['subscribersGained'] or '未取得'}")
        return
    sys.path.insert(0, str(ROOT / "youtube"))
    import yt
    done_any = False
    for d in sorted(EPS.iterdir()):
        if not (d / "state.json").exists():
            continue
        st = load_state(d)
        pub = st["publish"]
        if not pub.get("video_id") or not pub.get("publish_at"):
            continue
        pa = dt.datetime.fromisoformat(pub["publish_at"])
        for cp, delta in CHECKPOINTS.items():
            if st["analytics"].get(cp, {}).get("complete") or now() < pa + delta:
                continue
            row = {k: "" for k in CSV_COLS}
            row.update(recorded_at=now().isoformat(timespec="seconds"), episode=d.name, video_id=pub["video_id"],
                       checkpoint=cp, hours_since_publish=round((now() - pa).total_seconds() / 3600, 1))
            try:
                row["public_view_count"] = yt.public_stats(pub["video_id"]).get("viewCount", "")
                end = min(now().date(), (pa + delta).date())
                vals = yt.analytics(pub["video_id"], pa.date().isoformat(), end.isoformat(), METRICS)
                for m in METRICS:
                    row[m] = vals.get(m, "")  # 取得できない値は空欄（0にしない）
                row["data_status"] = "ok" if vals else "analytics未反映（後で再実行）"
            except Exception as e:  # noqa: BLE001
                row["data_status"] = "error: " + str(e)[:120]
            with open(csvp, "a", encoding="utf-8") as f:
                f.write(",".join(str(row[c]).replace(",", " ") for c in CSV_COLS) + "\n")
            st["analytics"][cp] = {"recorded_at": row["recorded_at"], "complete": row["data_status"] == "ok"}
            save_state(d, st)
            done_any = True
    print("記録しました" if done_any else "記録対象なし（公開後24時間/7日に達した動画がない）")


def cmd_status(a):
    write_todo()
    print((STATE_DIR / "TODO.md").read_text())


def cmd_auth(a):
    sys.path.insert(0, str(ROOT / "youtube"))
    import yt
    yt.authorize()
    ch = yt.my_channel()
    print("認証チャンネル:", ch["title"], ch["id"], "→ config/channel.toml の channel_id と照合してください")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("build", "verify", "render", "tts", "compose", "qc"):
        p = sub.add_parser(name)
        p.add_argument("ep")
    p = sub.add_parser("preview"); p.add_argument("ep"); p.add_argument("--step", type=int, default=6)
    p = sub.add_parser("publish"); p.add_argument("ep"); p.add_argument("--mode", choices=["local", "private", "schedule"])
    p.add_argument("--dry-run", action="store_true"); p.add_argument("--force-new-upload", action="store_true")
    p = sub.add_parser("analytics"); p.add_argument("--report", action="store_true")
    sub.add_parser("status")
    sub.add_parser("auth")
    a = ap.parse_args()
    globals()["cmd_" + a.cmd](a)


if __name__ == "__main__":
    main()
