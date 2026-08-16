# DeepSeek HPD Harness

English | [中文](README.zh.md)

DeepSeek HPD Harness is an open-source agent harness derived from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It applies HPD to real agent execution: decide the required capability before spending compute, express complex work as a dependency graph, execute independent work in parallel, and make the process visible and durable.

HPD means **Hierarchical · Parallel · Dynamic**. The project currently implements **H** and **P**; **D** is in development. The theory and motivation are described in the [HPD article (Chinese)](https://mp.weixin.qq.com/s/v2Sjuuc0aEk1Pmwxd124hA).

## About DSH

The project retains DSH's **everything is a plugin** architecture and is powered by [Cordis](https://github.com/cordiverse/cordis). Cordis's design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

That foundation keeps models, tools, sessions, settings, and UI contributions replaceable. HPD is implemented as plugins on those extension points rather than as a forked agent loop.

## What We Added

| HPD dimension | Status | What it does |
| --- | --- | --- |
| **H - Hierarchical** | Implemented | A level-1 assessment routes simple work to Light and complex work to an Expert Planner. Before every DAG node starts, level 2 selects both its Light/Expert tier and an execution strategy. |
| **P - Parallel** | Implemented | The Planner creates a validated dependency DAG. Every ready node runs in an isolated subagent, up to a default concurrency of three; dependent work waits for its predecessors. |
| **D - Dynamic** | In development | D will assess intermediate quality and execution feedback, revise a plan when needed, and select follow-up work dynamically. The current scheduler executes an accepted DAG without quality-driven replanning. |

For a complex task, the Expert Planner reasons in the main conversation and produces a 2-8 node DAG with concise titles, self-contained instructions, and dependencies. Its final JSON remains in history but is shown as a collapsed plan result.

P starts every dependency-ready node within the configured limit. Level 2 picks its model tier and one strategy: **Inspect-first** for maintenance and investigation, **Produce-first** for focused implementation, or **Adaptive** when neither is clearly preferable. The decision is durable and applies only to that isolated worker.

Independent branches continue when another branch fails. Pending descendants of a failed node become blocked, and the root Expert gives one final answer that includes useful results and states unfinished limits. Planning, execution, failure, interruption, summary, and completion remain visible in the durable plan snapshot; interrupted work is preserved for inspection and never resumes automatically.

P v1 relies on Planner dependencies for safety. Tasks that share mutable files, consume another node's result, or perform related external side effects must be ordered in the DAG; the runtime does not attempt file-conflict detection.

## What We Also Adapted

HPD combines its own scheduling model with the core ideas of two community projects to raise the useful ceiling of the model without turning the root conversation into a changing global prompt.

| Project | Core idea used here | HPD integration |
| --- | --- | --- |
| [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) | Start a root session with the real Minimal tool pair and no automatic workspace or skill injection; expose the full Standard catalog after the first durable signal. | The bundled **Anchored Standard** preset stabilizes the first-request trajectory and reduces initial prompt/tool noise. H keeps Planner and final synthesis on a compatible Expert prefix, while P workers retain the complete tool catalog. |
| [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) | Match a task to a behavior mode such as inspect-first, produce-first, or adaptive routing. | H's level-2 classifier selects the node strategy with its model tier. The selected scoped persona is visible in the task list and graph tooltip, persists with the plan, and affects only that subagent. |

The integration deliberately does not install routing-suite's runtime injector, global tool filtering, or per-message guidance. Anchored Standard owns the root prefix; HPD owns decomposition, parallel scheduling, durable progress, and node-local behavior. This keeps the Planner, summary, cache behavior, and child execution independently understandable.

The Anchored Standard adaptation and its attribution live in [`apps/cli/config/agent-presets/anchored-standard/`](apps/cli/config/agent-presets/anchored-standard/). It supports Linux, macOS, and Windows. On Windows, install Git for Windows for its Git Bash-compatible `bash` tool, or configure the preset's `bashPath`; other presets can still use PowerShell providers.

## What You Need to Configure

The composer has no per-message model selector. Configure the application before starting a session:

1. Open **Settings > Models** and configure a provider, API credential, endpoint, and available models. Credentials may also come from process environment variables or a repository-root `.env` file.
2. Open **Settings > Model Routing** and select a **Light Model** and an **Expert Model**. Auto reasoning effort leaves the setting to the adapter; Manual applies the selected effort to root requests on each route. A practical recommended pairing is DeepSeek V4 Flash for Light and DeepSeek V4 Pro for Expert.
3. Open **Settings > Agent presets** and make **Anchored Standard** the default for new sessions, or select it from the new-session preset chip. A preset is fixed at session creation because its history depends on that tool catalog.

Complex tasks show their state in both the conversation and the plan panel. The Planner's reasoning streams in the main conversation; its JSON result is collapsed by default. The plan panel offers a list and a task graph: list items show each short title, state, model tier, and strategy; graph nodes show the same model and strategy on hover or keyboard focus. A started node opens its corresponding subagent conversation. Blue means running, green completed, red failed, and gray pending or blocked.

## Run from Source

### Prerequisites

- Git
- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- Git Bash on Windows when using Anchored Standard
- A DeepSeek API key, or another provider configured later in **Settings > Models**

### Install and start

```sh
git clone https://github.com/HHHHH-GIT/Deepseek-HPD-Harness.git
cd Deepseek-HPD-Harness
pnpm install
```

For the built-in DeepSeek provider, create a gitignored `.env` file in the repository root:

```dotenv
DEEPSEEK_API_KEY=sk-your-key-here
# DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Build the packages and Web frontend, then start the application:

```sh
pnpm run build
pnpm dsh web
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080). To use another port:

```sh
pnpm dsh web --port 3081
```

After the first launch, configure **Models**, **Model Routing**, and **Agent presets**, then create a new session. During frontend development, keep the Web process running and start the rebuild watcher in another terminal:

```sh
pnpm run dev:web
```

## What We Still Need to Improve Together

H and P are useful first implementations, not a final answer to model scheduling. P currently gives every admitted DAG node an isolated one-shot subagent, up to a fixed concurrency cap. This favors independent execution and auditability, but it is not automatically the best choice for latency, token cost, cache reuse, or provider quotas.

### Cache hit rate

A root-session cache hit rate is no longer a complete measurement once work fans out. Each child has a separate request history: its first request cannot reuse the root conversation prefix, and its task instruction and completed dependencies change the later prefix. A low root-only rate can therefore hide cached child input, while a low aggregate rate can be the real cost of unnecessary fan-out.

We need to measure one task across the root session and all child sessions: input tokens, cached input tokens, output tokens, latency, retries, selected model and strategy, and the final result. The useful aggregate is `total cached input / total input` across every request in that task, compared with the same model and workload. That separates a telemetry accounting gap from a genuine cache regression.

The likely improvements are stable cache-aware prefixes, a small fixed persona set, compact dependency handoffs, and fewer fresh workers for work that should stay together. Planner and final synthesis already share a compatible Expert root prefix; the next work is to preserve reusable prefixes inside a worker chain without leaking unrelated sibling context.

### Better agent allocation

One worker can always execute a DAG in topological order, so it is the minimum worker count for correctness and removes parallel speedup. One worker per node exposes all available concurrency, but creates many fresh contexts and can cost more than it saves. The scheduling decision is therefore not simply the number of nodes.

Minimum DAG path cover is a useful baseline for grouping dependent work into worker chains. After defining whether a chain may use transitive precedence, it can be solved with a split-node bipartite graph and maximum matching; in the standard formulation the minimum cover is `n - maximum matching`. It minimizes the number of chains, not wall-clock time or token cost. With a fixed worker limit and precedence constraints, minimizing makespan is generally NP-hard, so HPD should use measured heuristics and small-instance exact solvers as references rather than claim one universal optimum.

Useful contributions include representative DAG workload sets, end-to-end cache and latency telemetry, cost estimators, worker-chain and continuable-subagent support, and benchmark schedulers. Exact maximum-matching, CP-SAT, or integer-programming solutions for small graphs can provide a baseline; critical-path list scheduling and clustering are more practical for larger live tasks.

## Development

Read the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md) before changing the project. Coding agents must also follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). Third-party dependencies and adapted components are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and their bundled notice files.
