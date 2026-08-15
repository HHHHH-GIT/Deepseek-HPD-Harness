# DeepSeek HPD Harness

English | [中文](README.zh.md)

DeepSeek HPD Harness is an open-source agent harness derived from DeepSeek Harness (`dsh`), built to bring the HPD workflow architecture to agent systems.

HPD means **Hierarchical · Parallel · Dynamic**: classify work before choosing its execution path, schedule independent planned work in parallel, and adapt later decisions to execution results and quality signals. H is available now; P and D are in development.

The harness uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## HPD architecture

DSH is evolving toward HPD: **Hierarchical · Parallel · Dynamic**, a workflow architecture that puts compute where it improves the result. [Read the HPD theory (Chinese)](https://mp.weixin.qq.com/s/v2Sjuuc0aEk1Pmwxd124hA).

| Dimension | Status | What it means |
| --- | --- | --- |
| H — Hierarchical | Available | Classifies each task by complexity: simple work goes directly to a Light model, while complex work enters an Expert planning and execution path. |
| P — Parallel | In development | Will schedule independent planned work in parallel from a task DAG, reducing wall-clock time without violating dependencies. |
| D — Dynamic | In development | Will use execution results, quality checks, and tool feedback to review, re-plan, and choose the next action. |

H is the first shipped HPD dimension. It executes an accepted plan in order today; P and D are under active development.

## What the H upgrade changes

H turns the default single-path agent run into a visible, complexity-aware workflow. It keeps direct work direct and adds a controlled planning path only when a task needs it.

| Without H routing | With H routing | User benefit |
| --- | --- | --- |
| One configured agent route handles every request. | A level-1 assessment sends simple requests to Light and reserves Expert planning for complex work. | Avoids planning and Expert-model overhead for small requests. |
| Planning can occur inside an ordinary, tool-enabled agent step. | The Planner is an isolated Expert request with no tools and no assistant step; it must produce the plan before subtask execution starts. | The Planner cannot complete the original task before showing the work to be done. |
| Progress depends on optional generic Todo state and may appear late or not at all. | Durable plan snapshots publish `planning`, ordered subtasks, active work, summary, completion, failure, and interruption to the H plan panel. | The plan appears immediately after complex routing, then each subtask advances in order. |
| Failure and cancellation leave only the normal transcript to inspect. | Planner failures show a clear state before an Expert direct-answer fallback; interrupted plans preserve their completed work and never auto-resume. | Clearer recovery without silently repeating side effects. |

## Run

```sh
git clone https://github.com/HHHHH-GIT/Deepseek-HPD-Harness.git
cd Deepseek-HPD-Harness
pnpm install
pnpm run build
pnpm dsh web
```

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
