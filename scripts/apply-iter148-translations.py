#!/usr/bin/env python3
"""Apply the 148 round's ja/ko term convergence.

Every edit is key-scoped: the raw JSON is matched on `"<leaf>": "<full old
value>"` and the script refuses to apply anything unless that pattern occurs
exactly once. A plain old-value -> new-value replace would be unsafe here —
`Tier` and `프로바이더` are short enough to appear inside unrelated strings, and
`description` is a leaf name that repeats across namespaces.

Run from the repository root.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

LOCALES = Path("packages/views/locales")

# (locale, namespace, leaf key, full old value, new value)
EDITS: list[tuple[str, str, str, str, str]] = [
    # --- A group: converge the outlier onto the bundle's own majority ---
    # `instance` — ja 10/11 already say インスタンス, and the sibling key with the
    # same English sentence spells it この Multica インスタンスでは.
    (
        "ja", "workspace", "description",
        "このMultica instanceでは新しいワークスペースを作成できません。既存のワークスペースへの招待を管理者に依頼してください。",
        "この Multica インスタンスでは新しいワークスペースを作成できません。既存のワークスペースへの招待を管理者に依頼してください。",
    ),
    # `instance` — ko 8/11 say 인스턴스. Two of the three offenders share an
    # English sentence with each other, so the majority is drawn from the other
    # eight keys (`runtimes.cloud_runtime.fields.instance_type` et al.).
    (
        "ko", "workspace", "description",
        "이 Multica instance에서는 새 워크스페이스를 만들 수 없습니다. 관리자에게 기존 워크스페이스 초대를 요청하세요.",
        "이 Multica 인스턴스에서는 새 워크스페이스를 만들 수 없습니다. 관리자에게 기존 워크스페이스 초대를 요청하세요.",
    ),
    (
        "ko", "onboarding", "creation_disabled_lede",
        "이 Multica instance에서는 새 워크스페이스를 만들 수 없습니다. 관리자가 기존 워크스페이스로 초대하면 초대를 수락한 뒤 새로고침해 계속하세요.",
        "이 Multica 인스턴스에서는 새 워크스페이스를 만들 수 없습니다. 관리자가 기존 워크스페이스로 초대하면 초대를 수락한 뒤 새로고침해 계속하세요.",
    ),
    (
        "ko", "onboarding", "creation_disabled_lede_resume",
        "이 instance에서는 워크스페이스 생성이 비활성화되어 있으므로 기존 워크스페이스로 계속 이동합니다.",
        "이 인스턴스에서는 워크스페이스 생성이 비활성화되어 있으므로 기존 워크스페이스로 계속 이동합니다.",
    ),
    # `Desktop` — 16/18 already say デスクトップ / 데스크톱. These two keys are the
    # only place the Latin product name "Multica Desktop" survives.
    (
        "ja", "auth", "open_button",
        "Multica Desktopを開く",
        "Multica デスクトップアプリを開く",
    ),
    (
        "ja", "runtimes", "managed_by_desktop_title",
        "CLI バイナリは Multica Desktop で管理されています。CLI をアップグレードするには Desktop を更新してください。",
        "CLI バイナリは Multica デスクトップアプリで管理されています。CLI をアップグレードするにはデスクトップアプリを更新してください。",
    ),
    (
        "ko", "auth", "open_button",
        "Multica Desktop 열기",
        "Multica 데스크톱 앱 열기",
    ),
    (
        "ko", "runtimes", "managed_by_desktop_title",
        "CLI 바이너리는 Multica Desktop에서 관리합니다. CLI를 업그레이드하려면 Desktop을 업데이트하세요.",
        "CLI 바이너리는 Multica 데스크톱 앱에서 관리합니다. CLI를 업그레이드하려면 데스크톱 앱을 업데이트하세요.",
    ),
    # `provider` — ja 20/23 say プロバイダー, ko 19/23 say 제공자. ko has two
    # outliers rather than the one the 147 scan recorded: `usage.errors.class.
    # provider` had taken 프로바이더.
    (
        "ja", "agents", "dialog_native_json_hint",
        "過去の Provider ネイティブ形式です。形式を変更せず JSON で編集できます。",
        "過去のプロバイダーネイティブ形式です。形式を変更せず JSON で編集できます。",
    ),
    (
        "ko", "agents", "dialog_native_json_hint",
        "기존 Provider 네이티브 형식입니다. 형식을 변경하지 않고 JSON으로 편집할 수 있습니다.",
        "기존 제공자 네이티브 형식입니다. 형식을 변경하지 않고 JSON으로 편집할 수 있습니다.",
    ),
    (
        "ko", "usage", "provider",
        "프로바이더",
        "제공자",
    ),
    # `Pull request` casing — 11/12 in each bundle already write it that way.
    # The outlier is the creation-studio prompt chip, whose English source is
    # lowercase prose ("Review frontend pull requests").
    (
        "ja", "agents", "prompt_review",
        "フロントエンドの Pull Request をレビュー",
        "フロントエンドの Pull request をレビュー",
    ),
    (
        "ko", "agents", "prompt_review",
        "프런트엔드 Pull Request 검토",
        "프런트엔드 Pull request 검토",
    ),

    # --- B group: no precedent in either bundle; standard rendering, zh 已译 ---
    # `batch` — zh 批次, and the namespace already transliterates credits
    # (クレジット / 크레딧), so the compound follows it.
    ("ja", "billing", "title", "クレジット batch", "クレジットバッチ"),
    ("ko", "billing", "title", "크레딧 batch", "크레딧 배치"),
    ("ja", "billing", "empty", "batch はまだありません。", "バッチはまだありません。"),
    ("ko", "billing", "empty", "아직 batch가 없습니다.", "아직 배치가 없습니다."),
    # `heartbeat` — zh 心跳.
    (
        "ja", "runtimes", "description",
        "直近 45 秒以内に heartbeat を受信しました。作業をディスパッチする準備ができています。",
        "直近 45 秒以内にハートビートを受信しました。作業をディスパッチする準備ができています。",
    ),
    (
        "ko", "runtimes", "description",
        "최근 45초 안에 heartbeat를 받았습니다. 작업을 디스패치할 준비가 되었습니다.",
        "최근 45초 안에 하트비트를 받았습니다. 작업을 디스패치할 준비가 되었습니다.",
    ),
    (
        "ja", "runtimes", "description",
        "5 分以上 heartbeat がありません。デーモンを再起動するか、ホストを調べてください。",
        "5 分以上ハートビートがありません。デーモンを再起動するか、ホストを調べてください。",
    ),
    (
        "ko", "runtimes", "description",
        "5분 넘게 heartbeat가 없습니다. 데몬을 다시 시작하거나 호스트를 확인하세요.",
        "5분 넘게 하트비트가 없습니다. 데몬을 다시 시작하거나 호스트를 확인하세요.",
    ),
    # `tier` — zh 档位.
    (
        "ja", "billing", "no_tiers",
        "設定された価格 tier がありません。Cloud に Stripe key が設定されていない可能性があり、checkout は 503 を返します。",
        "設定された価格ティアがありません。Cloud に Stripe key が設定されていない可能性があり、checkout は 503 を返します。",
    ),
    (
        "ko", "billing", "no_tiers",
        "설정된 가격 tier가 없습니다. Cloud에 Stripe key가 설정되지 않았을 수 있으며 checkout은 503을 반환합니다.",
        "설정된 가격 티어가 없습니다. Cloud에 Stripe key가 설정되지 않았을 수 있으며 checkout은 503을 반환합니다.",
    ),
    ("ja", "billing", "label_tier", "Tier", "ティア"),
    ("ko", "billing", "label_tier", "Tier", "티어"),
    # `Private` — the render point is a prose alert
    # (agents/components/tabs/agent-mcp-tab.tsx:146), and the word names the
    # agent access level whose own label ja/ko already translate as
    # プライベート / 비공개 (agents.access.private_title). It is not an enum
    # identifier: conventions.mdx keeps lowercase `owner`/`admin`/`member`
    # Latin, and this is neither lowercase nor an identifier.
    (
        "ja", "agents", "shared_warning",
        "このエージェントは共有されています。このエージェントを実行できる人は、ここで有効化した Composio アプリを利用できます。これらのアプリが機微なデータを扱う場合は、Private にするかアクセス範囲を絞ってください。",
        "このエージェントは共有されています。このエージェントを実行できる人は、ここで有効化した Composio アプリを利用できます。これらのアプリが機微なデータを扱う場合は、プライベートにするかアクセス範囲を絞ってください。",
    ),
    (
        "ko", "agents", "shared_warning",
        "이 에이전트는 공유되어 있습니다. 이 에이전트를 실행할 수 있는 사람은 여기서 활성화한 Composio 앱을 사용할 수 있습니다. 이러한 앱이 민감한 데이터를 노출한다면 Private로 설정하거나 접근 범위를 좁히세요.",
        "이 에이전트는 공유되어 있습니다. 이 에이전트를 실행할 수 있는 사람은 여기서 활성화한 Composio 앱을 사용할 수 있습니다. 이러한 앱이 민감한 데이터를 노출한다면 비공개로 설정하거나 접근 범위를 좁히세요.",
    ),
]

# The offline heartbeat key shares the leaf name `description` with the online
# one; both needles carry the full value, so each still matches exactly once.


def main() -> int:
    failures: list[str] = []
    applied = 0
    for locale, namespace, leaf, old, new in EDITS:
        path = LOCALES / locale / f"{namespace}.json"
        raw = path.read_text(encoding="utf-8")
        needle = f'"{leaf}": {json.dumps(old, ensure_ascii=False)}'
        count = raw.count(needle)
        if count != 1:
            failures.append(f"{locale}/{namespace}.json {leaf}: matched {count}x, expected 1")
            continue
        replacement = f'"{leaf}": {json.dumps(new, ensure_ascii=False)}'
        path.write_text(raw.replace(needle, replacement), encoding="utf-8")
        applied += 1

    if failures:
        print(f"FAILED after {applied} edits — these did not apply:", file=sys.stderr)
        for line in failures:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(f"applied {applied} edits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
