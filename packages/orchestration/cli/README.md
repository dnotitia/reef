# @reef/orchestration-cli

하나의 work URI를 foreground에서 실행하는 private adapter입니다. 실제 실행
산출물은 `dist/cli.js`이며 invocation은 다음 하나만 지원합니다.

```text
run <canonical-work-uri> --config <absolute-json-path>
```

CLI는 Reef work snapshot을 읽고 immutable provider-bound `RunPlan`을 만든 뒤
controller claim과 `@reef/orchestrator`의 one-run 경계를 실행합니다. queued work
선택, daemon, workspace 생성, delivery ordering, branch/PR 전달은 이 패키지의
책임이 아닙니다. Credentials는 argv나 JSON에 직접 넣지 않고 config가 지정한
환경 변수 이름으로만 읽습니다.

## Canonical E2E commands

```bash
pnpm --filter @reef/orchestration-cli run test:e2e
pnpm --filter @reef/orchestration-cli run dev:e2e
```

`test:e2e`는 먼저 package를 build한 뒤 실제 `node dist/cli.js` child process를
격리 fixture마다 실행합니다. Fixture는 매 실행마다 고유 temporary root, controller
state, Git working repository, bare remote와 OS port를 만들고, local HTTP server가
Reef work와 GitHub 경계를 제공합니다. 정상·설정/provider resolution 실패·duplicate
claim·SIGINT cancellation·redaction·병렬 격리를 검증한 뒤 fixture server와 root를
제거합니다. 정상 fixture는 built resolver가 만든 실제 SCM adapter를 GitHub API
fixture에 연결해 adapter 경계도 확인하며, CLI 자체에 delivery 흐름을 추가하지
않습니다.

`dev:e2e`는 같은 fixture를 장기 실행하고 종료 신호까지 유지합니다. 준비가 끝나면
stdout에 다음 source-neutral descriptor를 한 줄씩 출력합니다.

```text
REEF_E2E_READY=1
REEF_E2E_WORK_URI=reef://fixture-vault/REEF-101
REEF_E2E_PORT=<fixture port>
REEF_E2E_CLI_COMMAND=<synthetic-env + node dist/cli.js command>
REEF_E2E_INVALID_CONFIG_COMMAND=<direct command>
REEF_E2E_PROVIDER_MISMATCH_COMMAND=<direct command>
REEF_E2E_DUPLICATE_COMMAND=<same direct command; run twice concurrently>
REEF_E2E_CANCEL_COMMAND=<same direct command; send SIGINT to its child>
REEF_E2E_STOP=send SIGINT or SIGTERM to this runtime PID <pid>
```

`REEF_E2E_CLI_COMMAND`의 synthetic environment 값은 fixture 전용 canary이며 실제
credential이 아닙니다. Source-blind 검증자는 위 descriptor와 terminal만 사용해
command를 실행하고, duplicate는 같은 command 두 개를 동시에 시작하며, cancellation은
running child에 SIGINT를 보냅니다. Runtime 자체는 SIGINT/SIGTERM을 받으면 listener와
temporary root를 정리하고 종료합니다.

CLI process의 정상 observable은 stdout의 terminal JSON 정확히 한 줄, stderr의
progress JSONL, 그리고 outcome별 exit code입니다. `0`은 succeeded, `1`은 failed,
`2`는 config/provider preflight 단계 실패, `3`은 duplicate claim, `130`은 cancellation을
뜻합니다. Secret canary와 private fixture path는 CLI stdout/stderr, terminal result,
controller state에 기록되지 않습니다.
