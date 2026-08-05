# @reef/work-provider-reef

`@reef/work-provider-reef`는 Reef issue를 provider-neutral
`@reef/orchestrator`의 `WorkProvider` 계약으로 연결하는 private adapter입니다.

```ts
import { createReefWorkProvider } from "@reef/work-provider-reef";

const provider = createReefWorkProvider({
  adapter,
  jwt,
  vault: "reef-test",
  repository: "dnotitia/reef",
});
```

패키지는 다음 경계를 지킵니다.

- `reef://reef-test/REEF-001` URI만 canonical 형태로 허용합니다.
- issue document, `reef_issues` row, dependency와 current actor는 `@reef/core`로 읽습니다.
- status, comment와 implementation ref 변경은 `@reef/core`의 기존 update funnel을
  사용해 Reef metadata와 activity를 보존합니다.
- snapshot revision은 secret-free SHA-256 digest이며, credential이나 raw AKB payload를
  provider result/error에 노출하지 않습니다.

이 패키지는 queue, scheduler, run-state persistence, web route, CLI, 또는 새로운 Reef
schema/table을 소유하지 않습니다.
