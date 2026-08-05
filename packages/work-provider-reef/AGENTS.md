# `work-provider-reef` 패키지 규칙

이 패키지는 Reef의 구체적인 AKB `WorkProvider` 구현만 소유합니다.

- provider-neutral 계약과 오류 정규화는 `@reef/orchestrator`를 그대로 사용하고,
  AKB issue/auth/comment/activity I/O는 `@reef/core`의 public adapter funnel만 사용합니다.
- 새 Reef 테이블, SQL wire schema, scheduler, persistence, web/CLI surface를 추가하지
  않습니다. credential은 factory closure 밖으로 노출하지 않습니다.
- 모든 operation은 canonical `reef://<vault>/<REEF-ID>`와 configured vault를 mutation
  전에 검증하고, `AbortSignal`을 마지막 read 뒤 mutation 직전까지 확인합니다.
- 반환 snapshot과 `ProviderError` serialization에는 credential, raw AKB payload, issue body,
  prompt, mutable handle을 넣지 않습니다.
- 테스트는 실제 `@reef/core` funnel을 호출하는 scripted `AkbAdapter` fixture를 사용하며
  shared vault를 변경하지 않습니다.
