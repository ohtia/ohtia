# Ohtia

Ohtia (pronounced “oh-tee-ah”) is an open-source desktop workspace for academic research. Keep your projects local, connect your own AI agents and search providers, and develop theses and scientific papers grounded in traceable evidence.

## Product direction

Ohtia is being designed to help undergraduate students, graduate students, and researchers turn sources into understanding: explore literature, examine evidence, connect ideas, and develop their own arguments for theses, scientific papers, and other academic work.

- **Researcher authorship.** The researcher writes the thesis or paper. Ohtia provides questions, source summaries, and criticism grounded in evidence rather than replacement prose.
- **Local projects.** Sources, notes, drafts, and research history belong on the researcher's computer. Using Ohtia will not require an Ohtia account.
- **Traceable evidence.** Claims and observations should retain their source, the version examined, and a precise location where possible. Evidence, interpretation, and inference remain distinct.
- **Human judgment.** AI-generated proposals remain separate from knowledge the researcher has reviewed and confirmed. Uncertainty and incomplete coverage must stay visible.
- **Connected inference.** The initial integrations are planned for OpenAI and Anthropic products, using supported access methods. Support for additional agents will be added through adapters in the near future.
- **Configurable search.** Researchers choose which search providers to enable. Each adapter should support the public, API key, or sign-in access methods offered by its provider.
- **Durable research.** Projects should preserve versions, provenance, and decisions, with recoverable schema upgrades and manuscript outputs that remain useful beyond a particular model or subscription.

Local project storage does not mean all processing happens locally. Enabled AI and search connections may send requests or selected content to external services. Connections must make those transfers clear and respect the restrictions attached to research materials.

## Planned desktop platforms

Windows, macOS, and Linux, distributed as graphical desktop applications using Electron. React and TypeScript are the intended interface stack. Tablet and phone applications are outside the initial scope.

## Product and architecture

The [product definition](docs/product-definition.md) sets Ohtia's purpose, trust and scope, and the [thesis workflow](docs/thesis-workflow.md) describes how it supports research and scientific papers. The [system architecture](docs/architecture.md) defines local execution and provider boundaries; the [frontend architecture](docs/frontend-architecture.md) defines the graphical desktop experience.

The [product roadmap](docs/product-roadmap.md) explains the delivery sequence, researcher outcomes and contributor foundations. Availability follows verified release readiness rather than fixed dates.

The [design system](docs/design-system.md) defines visual identity, tokens and interaction patterns. [Workspace layout](docs/workspace-layout.md) defines panel geometry, accessible controls and layout preferences. The [Exploration–Action Framework](docs/exploration-action-framework.md) defines the workflow's notation. The [data model](docs/data-model.md) defines the source library, research projects and versioned manuscripts. The [academic draft format](docs/draft-format.md) defines the manuscript independently of its editor. Significant choices and their rationale live in the [architecture decision register](docs/adr/index.md).

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or submitting a pull request. We especially welcome help translating the interface and reviewing linguistic quality. Maintainers can find GitHub configuration and verification procedures in [Repository policy](docs/repository-policy.md).

Documentation starts at [docs/index.md](docs/index.md); its format is defined in [AGENTS.md](AGENTS.md#documentation-and-open-knowledge-format).

## License

[MIT](LICENSE). Copyright (c) 2026 Adrian Mastronardi & Mónica Pené.
