# Contributing to Amadeus

Thank you for your interest in contributing to Amadeus!

Whether you're fixing a bug, improving the interface, adding functionality, or suggesting an improvement, contributions are welcome.

This document explains how to contribute to the project.

## 1. Before You Start

- Read the project's [readme.md](./readme.md) to understand its purpose and architecture.
- Check existing issues and pull requests before starting work.
- For larger changes, open an issue or discuss your proposal with the maintainer first.
- Keep contributions focused. Avoid unrelated changes.

You do not need to be an expert in every technology used by Amadeus. However, familiarity with Git and the relevant parts of the codebase is recommended.

## 2. Development Workflow

Amadeus uses a fork-based contribution workflow.

Contributors should never push directly to the upstream `main` branch. (and can't)

### Step 1: Fork the Repository

Create your own fork of the Amadeus repository through GitHub.

### Step 2: Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/Amadeus.git
cd Amadeus
```

### Step 3: Configure Upstream

Add the original repository as an upstream remote:

```bash
git remote add upstream https://github.com/RUN1-CS/Amadeus.git
```

### Step 4: Create a Branch

Create a dedicated branch for your changes.

```bash
git checkout -b feature/your-feature
```

Suggested branch prefixes:

- `new-feature/` — New functionality
- `fix/` — Bug fixes
- `design/` — Interface and visual improvements
- `docs/` — Documentation
- `refactor/` — Code restructuring

### Step 5: Make Your Changes

Implement your changes while following the project's existing conventions.

Before committing:

- Review your changes.
- Remove temporary files and debugging code.
- Never include credentials, API keys, tokens, or private configuration.
- Ensure unrelated functionality remains unaffected.

### Step 6: Commit and Push

Use descriptive commit messages.

```bash
git add .
git commit -m "Redesign application interface"
git push origin feature/your-feature
```

### Step 7: Open a Pull Request

Open a pull request from your fork and branch into the upstream `main` branch.

Your pull request should include:

- A clear title.
- A description of the changes.
- The motivation behind the changes.
- Screenshots for visual changes, where applicable.
- Any relevant issue references.

The maintainer will review your contribution and may request modifications before merging.

## 3. Code Guidelines

- Follow existing naming and formatting conventions.
- Prefer readable and maintainable implementations.
- Avoid unnecessary dependencies.
- Keep changes modular and focused.
- Do not introduce unrelated architectural changes without prior discussion.
- Do not commit generated files unless required by the project.

AI-assisted development is permitted. However, contributors remain responsible for understanding, reviewing, and testing the code they submit.

AI-generated code is subject to exactly the same review requirements as manually written code.

## 4. Security

Security is a priority.

Never commit:

- API keys or access tokens.
- Passwords or authentication credentials.
- Private certificates or private keys.
- Production environment files.
- Personal or confidential data.

Report security vulnerabilities privately to the maintainer rather than opening a public issue containing exploit details.

## 5. Pull Request Review

All contributions must pass the project's review process.

Pull requests may be:

- Approved and merged.
- Returned with requested changes.
- Rejected if they conflict with project goals or technical requirements.

GitHub Actions may run automated checks against submitted contributions.

Passing automated checks does not guarantee acceptance.

# 6. Copyright and Licensing

By submitting a contribution to Amadeus, you agree that:

1. Your contribution is your original work, or you have permission to submit it.
2. You have the right to submit the contribution under the project's license.
3. Your contribution will be distributed under GNU General Public License v3.0 or later (GPL-3.0-or-later).
4. You retain copyright ownership of your original contributions unless otherwise agreed.

Contributors must not submit code, assets, or other materials that they do not have the necessary rights to license.

Unless explicitly agreed otherwise, contributions are accepted under the same license as the project.

## 7. Questions and Discussions

If you are unsure about an implementation, architectural decision, or contribution process, open a discussion or contact the maintainer before investing significant time.

Thank you for helping improve Amadeus!

**Log. Track. Control.**
