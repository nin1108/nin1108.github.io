"""YouTube Data API v3 / YouTube Analytics API v2 の最小クライアント（requests のみ使用）。

秘密情報の置き場所（Git管理外・権限600）:
  ~/.config/shorts-youtube/client_secret.json   Google Cloud の OAuth クライアント（デスクトップアプリ）
  ~/.config/shorts-youtube/token.json           認証後に保存されるトークン
  ~/.config/shorts-youtube/sessions/<ep>.json   再開可能アップロードのセッションURL
これらの中身はログや標準出力に出さない。

スコープ（必要最小限）:
  youtube.upload           動画のアップロード
  youtube                  動画情報の読み戻し・サムネイル設定・自チャンネル確認
  yt-analytics.readonly    公開後の数値
"""
from __future__ import annotations

import http.server
import json
import os
import secrets
import socket
import time
import urllib.parse
from pathlib import Path

import requests

SECRET_DIR = Path(os.environ.get("SHORTS_YT_DIR", Path.home() / ".config" / "shorts-youtube"))
CLIENT = SECRET_DIR / "client_secret.json"
TOKEN = SECRET_DIR / "token.json"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
API = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"
ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports"


class NotConfigured(RuntimeError):
    pass


def _secure_write(p: Path, data: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(p.parent, 0o700)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(data)


def _client():
    if not CLIENT.exists():
        raise NotConfigured(f"OAuthクライアントがありません: {CLIENT}")
    d = json.loads(CLIENT.read_text())
    return d.get("installed") or d.get("web")


def authorize(port: int = 8765):
    """ループバック方式でブラウザ認証し token.json を保存する（ユーザーの手元で実行）。"""
    c = _client()
    state = secrets.token_urlsafe(16)
    redirect = f"http://127.0.0.1:{port}/"
    url = c["auth_uri"] + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent", "state": state})
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("認証を受け取りました。このタブは閉じてかまいません。".encode())

        def log_message(self, *a):
            pass

    print("次のURLをブラウザで開いて、投稿先チャンネルのGoogleアカウントで許可してください:\n" + url)
    srv = http.server.HTTPServer(("127.0.0.1", port), H)
    srv.timeout = 600
    srv.handle_request()
    if got.get("state") != state or "code" not in got:
        raise RuntimeError("認証が完了しませんでした（state不一致またはcodeなし）")
    r = requests.post(c["token_uri"], data={
        "code": got["code"], "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect, "grant_type": "authorization_code"}, timeout=30)
    r.raise_for_status()
    tok = r.json()
    tok["obtained_at"] = time.time()
    _secure_write(TOKEN, json.dumps(tok))
    print("トークンを保存しました（内容は表示しません）")


def _token():
    if not TOKEN.exists():
        raise NotConfigured("未認証です。`python3 sk.py auth` を手元のPCで実行してください")
    tok = json.loads(TOKEN.read_text())
    if time.time() > tok.get("obtained_at", 0) + tok.get("expires_in", 0) - 120:
        c = _client()
        r = requests.post(c["token_uri"], data={
            "client_id": c["client_id"], "client_secret": c["client_secret"],
            "refresh_token": tok["refresh_token"], "grant_type": "refresh_token"}, timeout=30)
        r.raise_for_status()
        new = r.json()
        tok.update(new)
        tok["obtained_at"] = time.time()
        _secure_write(TOKEN, json.dumps(tok))
    return tok["access_token"]


def _h(extra=None):
    h = {"Authorization": f"Bearer {_token()}"}
    if extra:
        h.update(extra)
    return h


def _err(r):
    try:
        e = r.json().get("error", {})
        reasons = [x.get("reason") for x in e.get("errors", [])]
        return f"HTTP {r.status_code} {e.get('message', '')} {reasons}"
    except Exception:
        return f"HTTP {r.status_code}"


def my_channel():
    r = requests.get(f"{API}/channels", params={"part": "id,snippet,contentDetails,status", "mine": "true"},
                     headers=_h(), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    items = r.json().get("items", [])
    if not items:
        raise RuntimeError("認証アカウントにチャンネルがありません")
    it = items[0]
    return {"id": it["id"], "title": it["snippet"]["title"],
            "uploads": it["contentDetails"]["relatedPlaylists"]["uploads"]}


def get_video(video_id):
    r = requests.get(f"{API}/videos", params={"part": "id,snippet,status,processingDetails,contentDetails",
                                              "id": video_id}, headers=_h(), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    items = r.json().get("items", [])
    return items[0] if items else None


def recent_uploads(uploads_playlist, n=25):
    r = requests.get(f"{API}/playlistItems", params={"part": "snippet,contentDetails", "playlistId": uploads_playlist,
                                                     "maxResults": n}, headers=_h(), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    return [{"video_id": it["contentDetails"]["videoId"], "title": it["snippet"]["title"],
             "published": it["contentDetails"].get("videoPublishedAt")} for it in r.json().get("items", [])]


# ------------------------------------------------------------ 再開可能アップロード
def start_session(body: dict, size: int, notify=True):
    r = requests.post(UPLOAD, params={"uploadType": "resumable", "part": "snippet,status",
                                      "notifySubscribers": str(notify).lower()},
                      headers=_h({"Content-Type": "application/json; charset=UTF-8",
                                  "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)}),
                      data=json.dumps(body), timeout=60)
    if r.status_code != 200:
        raise RuntimeError("セッション開始失敗: " + _err(r))
    return r.headers["Location"]


def session_status(session_url, size):
    """戻り値: ("done", video_json) / ("partial", next_byte) / ("gone", None)"""
    r = requests.put(session_url, headers=_h({"Content-Range": f"bytes */{size}", "Content-Length": "0"}), timeout=60)
    if r.status_code in (200, 201):
        return "done", r.json()
    if r.status_code == 308:
        rng = r.headers.get("Range")
        return "partial", (int(rng.split("-")[1]) + 1) if rng else 0
    if r.status_code in (404, 410):
        return "gone", None
    raise RuntimeError("セッション確認失敗: " + _err(r))


def upload_from(session_url, path: Path, start: int, chunk=8 * 1024 * 1024):
    size = path.stat().st_size
    with open(path, "rb") as f:
        f.seek(start)
        pos = start
        while pos < size:
            data = f.read(chunk)
            end = pos + len(data) - 1
            r = requests.put(session_url, data=data, timeout=300,
                             headers=_h({"Content-Length": str(len(data)), "Content-Range": f"bytes {pos}-{end}/{size}"}))
            if r.status_code in (200, 201):
                return r.json()
            if r.status_code == 308:
                rng = r.headers.get("Range")
                pos = int(rng.split("-")[1]) + 1 if rng else 0
                f.seek(pos)
                continue
            raise RuntimeError("アップロード失敗: " + _err(r))
    st, v = session_status(session_url, size)
    if st == "done":
        return v
    raise RuntimeError(f"アップロード未完了: {st}")


def set_thumbnail(video_id, path: Path):
    ctype = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    r = requests.post("https://www.googleapis.com/upload/youtube/v3/thumbnails/set",
                      params={"videoId": video_id, "uploadType": "media"},
                      headers=_h({"Content-Type": ctype}), data=path.read_bytes(), timeout=120)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    return r.json()


def set_caption(video_id, srt_path: Path, lang="ja", name="日本語"):
    meta = {"snippet": {"videoId": video_id, "language": lang, "name": name, "isDraft": False}}
    boundary = "shorts" + secrets.token_hex(8)
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
            f"--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + srt_path.read_bytes() + \
        f"\r\n--{boundary}--".encode()
    r = requests.post("https://www.googleapis.com/upload/youtube/v3/captions",
                      params={"part": "snippet", "uploadType": "multipart"},
                      headers=_h({"Content-Type": f"multipart/related; boundary={boundary}"}), data=body, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    return r.json()["id"]


# ------------------------------------------------------------ Analytics
def analytics(video_id, start_date, end_date, metrics):
    r = requests.get(ANALYTICS, params={"ids": "channel==MINE", "startDate": start_date, "endDate": end_date,
                                        "metrics": ",".join(metrics), "filters": f"video=={video_id}"},
                     headers=_h(), timeout=60)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    d = r.json()
    cols = [c["name"] for c in d.get("columnHeaders", [])]
    rows = d.get("rows") or []
    return dict(zip(cols, rows[0])) if rows else {}


def public_stats(video_id):
    r = requests.get(f"{API}/videos", params={"part": "statistics", "id": video_id}, headers=_h(), timeout=30)
    if r.status_code != 200:
        raise RuntimeError(_err(r))
    items = r.json().get("items", [])
    return items[0]["statistics"] if items else {}


def online() -> bool:
    try:
        socket.create_connection(("www.googleapis.com", 443), timeout=5).close()
        return True
    except OSError:
        return False
