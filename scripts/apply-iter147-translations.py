#!/usr/bin/env python3
"""Fill the two settings surfaces that ja and ko never translated.

Every value below is derived, not invented: the anchor is the parallel string
in a sibling namespace of the same bundle (settings.github / settings.lark /
settings.slack / settings.dingtalk / settings.wecom / settings.tokens), or the
same English source rendered elsewhere in the bundle. The zh bundle is only a
reading aid for meaning.

`webhook_url_label` is deliberately absent: `Webhook URL` stays Latin in ja and
ko exactly as `autopilots.trigger_row.webhook_url_label` already does.

Replacement is per key, inside the namespace block, asserting exactly one hit.
A whole-file JSON re-serialisation would reformat the inline nested objects
elsewhere in settings.json.
"""

import json
import sys

LOCALES = "packages/views/locales"

JA_VCS = {
    "section_title": "Git プロバイダー（セルフホスト）",
    "connect_title": "プロバイダーインスタンスを接続",
    "connected_as": "{{login}} として接続済み",
    "form_provider_label": "プロバイダー",
    "form_instance_url_label": "インスタンス URL",
    "form_token_label": "アクセストークン",
    "form_token_placeholder": "アクセストークン",
    "form_token_hint": (
        "リポジトリの読み取り権限を持つアクセストークンを作成します。"
        "Forgejo/Gitea: 設定、アプリケーション。GitLab: read_api スコープを持つ個人アクセストークン。"
    ),
    "connect": "接続",
    "connecting": "接続中...",
    "disconnect": "接続解除",
    "disconnecting": "接続解除中...",
    "not_configured": (
        "このサーバーには Git プロバイダー連携が設定されていません。"
        "管理者に次の値を設定するよう依頼してください:"
    ),
    "contact_admin": "ワークスペースの admin に Git プロバイダーインスタンスの接続を依頼してください。",
    "webhook_setup_title": "プロバイダー側でセットアップを完了してください",
    "webhook_setup_description": (
        "リポジトリまたは組織に Webhook を追加し、以下の URL とシークレットを設定します。"
        "Forgejo/Gitea: 形式で Gitea を選び、イベントで Pull request（および Commit Status）を選択します。"
        "GitLab: トークンにシークレットを貼り付け、Merge request と Pipeline のイベントを有効にします。"
    ),
    "webhook_secret_label": "Webhook Secret",
    "webhook_secret_warning": (
        "今すぐシークレットをコピーしてください。表示されるのは一度だけで、あとから確認することはできません。"
    ),
    "copy": "コピー",
    "copied": "クリップボードにコピーしました",
    "copy_failed": "コピーできませんでした",
    "disconnect_confirm_title": "このプロバイダーの接続を解除しますか？",
    "disconnect_confirm_cancel": "キャンセル",
    "disconnect_confirm_action": "接続解除",
    "toast_connected": "プロバイダーを接続しました",
    "toast_connect_failed": "プロバイダーに接続できませんでした",
    "toast_disconnected": "プロバイダーの接続を解除しました",
    "toast_disconnect_failed": "接続を解除できませんでした",
    "regenerate_webhook": "Webhook を再生成",
    "rotate_confirm_title": "Webhook シークレットを再生成しますか？",
    "rotate_confirm_description": (
        "現在の Webhook シークレットはすぐに無効になります。"
        "プロバイダー設定で Webhook シークレットを更新するまで、Git プロバイダーからの配信は失敗します。"
    ),
    "rotate_confirm_cancel": "キャンセル",
    "rotate_confirm_action": "再生成",
    "rotating": "再生成中...",
    "toast_rotated": "Webhook シークレットを再生成しました",
    "toast_rotate_failed": "Webhook シークレットを再生成できませんでした",
}

KO_VCS = {
    "section_title": "Git 제공자(셀프 호스팅)",
    "connect_title": "제공자 인스턴스 연결",
    "connected_as": "{{login}}(으)로 연결됨",
    "form_provider_label": "제공자",
    "form_instance_url_label": "인스턴스 URL",
    "form_token_label": "액세스 토큰",
    "form_token_placeholder": "액세스 토큰",
    "form_token_hint": (
        "저장소 읽기 권한이 있는 액세스 토큰을 만드세요. "
        "Forgejo/Gitea: 설정, 애플리케이션. GitLab: read_api 범위의 개인 액세스 토큰."
    ),
    "connect": "연결",
    "connecting": "연결 중...",
    "disconnect": "연결 해제",
    "disconnecting": "연결 해제 중...",
    "not_configured": (
        "이 서버에는 Git 제공자 연동이 설정되어 있지 않습니다. "
        "관리자에게 다음 값을 설정하도록 요청하세요:"
    ),
    "contact_admin": "워크스페이스 관리자에게 Git 제공자 인스턴스 연결을 요청하세요.",
    "webhook_setup_title": "제공자에서 설정을 완료하세요",
    "webhook_setup_description": (
        "저장소 또는 조직에 Webhook을 추가하고 아래 URL과 시크릿을 설정하세요. "
        "Forgejo/Gitea: 형식에서 Gitea를 선택하고 이벤트에서 Pull request(및 Commit Status)를 선택하세요. "
        "GitLab: 토큰에 시크릿을 붙여넣고 Merge request와 Pipeline 이벤트를 활성화하세요."
    ),
    "webhook_secret_label": "Webhook Secret",
    "webhook_secret_warning": (
        "지금 시크릿을 복사하세요. 한 번만 표시되며 나중에 다시 확인할 수 없습니다."
    ),
    "copy": "복사",
    "copied": "클립보드에 복사했습니다",
    "copy_failed": "복사하지 못했습니다",
    "disconnect_confirm_title": "이 제공자의 연결을 해제할까요?",
    "disconnect_confirm_cancel": "취소",
    "disconnect_confirm_action": "연결 해제",
    "toast_connected": "제공자를 연결했습니다",
    "toast_connect_failed": "제공자에 연결하지 못했습니다",
    "toast_disconnected": "제공자 연결을 해제했습니다",
    "toast_disconnect_failed": "연결을 해제하지 못했습니다",
    "regenerate_webhook": "Webhook 재발급",
    "rotate_confirm_title": "Webhook 시크릿을 재발급할까요?",
    "rotate_confirm_description": (
        "현재 Webhook 시크릿은 즉시 작동을 멈춥니다. "
        "제공자 설정에서 Webhook 시크릿을 업데이트할 때까지 Git 제공자에서 보내는 전달이 실패합니다."
    ),
    "rotate_confirm_cancel": "취소",
    "rotate_confirm_action": "재발급",
    "rotating": "재발급 중...",
    "toast_rotated": "Webhook 시크릿을 재발급했습니다",
    "toast_rotate_failed": "Webhook 시크릿을 재발급하지 못했습니다",
}

JA_COMPOSIO = {
    "page_description": (
        "エージェントが操作できる Composio アプリを接続します。"
        "ここには、Composio プロジェクトで有効な auth config を設定済みのアプリだけが表示されます。"
    ),
    "not_enabled_title": "Composio 連携が有効になっていません",
    "not_enabled_description_prefix": "サーバーで",
    "not_enabled_description_suffix": "を設定すると Composio toolkit 接続が有効になります。",
    "loading": "toolkit を読み込み中…",
    "load_failed": "Composio toolkit を読み込めませんでした。",
    "empty_title": "接続できるアプリはまだありません",
    "empty_description": (
        "Composio プロジェクトに有効な auth config を持つ toolkit はまだありません。"
        "Composio ダッシュボードで有効にすると、ここに表示されます。"
    ),
    "search_placeholder": "toolkit を検索…",
    "connect": "接続",
    "connecting": "接続中…",
    "connected": "接続済み",
    "disconnect": "切断",
    "disconnecting": "切断中…",
    "connect_failed": "接続を開始できませんでした。もう一度お試しください。",
    "disconnect_failed": "切断できませんでした。もう一度お試しください。",
    "toast_disconnected": "切断しました",
    "disconnect_confirm_title": "このアプリを切断しますか？",
    "disconnect_confirm_description": (
        "接続済みのアカウントは Composio 側で取り消され、エージェントはこの toolkit にアクセスできなくなります。"
        "あとから再接続できます。"
    ),
    "disconnect_confirm_cancel": "キャンセル",
    "connections_load_failed": "既存の接続を読み込めなかったため、接続状態が不完全な可能性があります。",
}

KO_COMPOSIO = {
    "page_description": (
        "에이전트가 사용할 수 있는 Composio 앱을 연결하세요. "
        "Composio 프로젝트에서 활성화된 auth config가 설정된 앱만 여기에 표시됩니다."
    ),
    "not_enabled_title": "Composio 연동이 활성화되지 않았어요",
    "not_enabled_description_prefix": "서버에서",
    "not_enabled_description_suffix": "를 설정하면 Composio toolkit 연결이 활성화됩니다.",
    "loading": "toolkit을 불러오는 중…",
    "load_failed": "Composio toolkit을 불러오지 못했습니다.",
    "empty_title": "아직 연결할 수 있는 앱이 없어요",
    "empty_description": (
        "Composio 프로젝트에 활성화된 auth config가 있는 toolkit이 아직 없습니다. "
        "Composio 대시보드에서 활성화하면 여기에 표시됩니다."
    ),
    "search_placeholder": "toolkit 검색…",
    "connect": "연결",
    "connecting": "연결 중…",
    "connected": "연결됨",
    "disconnect": "연결 해제",
    "disconnecting": "연결 해제 중…",
    "connect_failed": "연결을 시작하지 못했습니다. 다시 시도해 주세요.",
    "disconnect_failed": "연결을 해제하지 못했습니다. 다시 시도해 주세요.",
    "toast_disconnected": "연결을 해제했어요",
    "disconnect_confirm_title": "이 앱의 연결을 해제할까요?",
    "disconnect_confirm_description": (
        "연결된 계정은 Composio에서 해지되고 에이전트는 이 toolkit에 접근할 수 없게 됩니다. "
        "나중에 다시 연결할 수 있습니다."
    ),
    "disconnect_confirm_cancel": "취소",
    "connections_load_failed": "기존 연결을 불러오지 못해 연결 상태가 불완전할 수 있습니다.",
}

PLAN = {
    ("ja", "vcs"): JA_VCS,
    ("ko", "vcs"): KO_VCS,
    ("ja", "composio"): JA_COMPOSIO,
    ("ko", "composio"): KO_COMPOSIO,
}


def namespace_slice(raw: str, ns: str) -> tuple[int, int]:
    """Byte range of the `"ns": { ... }` block.

    Scanned by line, not by brace counting: `connected_as` holds `{{login}}`,
    which is a brace pair inside a string and would close a naive matcher early.
    """
    lines = raw.splitlines(keepends=True)
    offset = 0
    start = None
    for line in lines:
        if start is None:
            if line == f'  "{ns}": {{\n':
                start = offset
        elif line in ("  },\n", "  }\n"):
            return start, offset + len(line)
        offset += len(line)
    raise SystemExit(f"no block found for {ns}")


def rewrite(raw: str, ns: str, mapping: dict[str, str], failures: list[str], tag: str) -> str:
    lo, hi = namespace_slice(raw, ns)
    block = raw[lo:hi]
    for key, value in mapping.items():
        encoded = json.dumps(value, ensure_ascii=False)
        line = f'    "{key}": '
        hits = block.count(line)
        if hits != 1:
            failures.append(f"{tag} {ns}.{key}: {hits} line hits, expected 1")
            continue
        at = block.index(line) + len(line)
        end = block.index("\n", at)
        old = block[at:end]
        if not old.startswith('"'):
            failures.append(f"{tag} {ns}.{key}: unexpected value shape {old!r}")
            continue
        comma = "," if old.endswith(",") else ""
        if old == encoded + comma:
            failures.append(f"{tag} {ns}.{key}: value already set")
            continue
        block = block[:at] + encoded + comma + block[end:]
    return raw[:lo] + block + raw[hi:]


def main() -> int:
    failures: list[str] = []
    staged: dict[str, str] = {}
    for (locale, ns), mapping in PLAN.items():
        path = f"{LOCALES}/{locale}/settings.json"
        raw = staged.get(path) or open(path, encoding="utf8").read()
        raw = rewrite(raw, ns, mapping, failures, locale)
        json.loads(raw)  # must stay valid JSON
        staged[path] = raw

    if failures:
        print("FAILED (nothing written):", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1

    for path, raw in staged.items():
        open(path, "w", encoding="utf8").write(raw)
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
