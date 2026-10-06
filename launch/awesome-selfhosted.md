# awesome-selfhosted

Rules checked on 2026-10-07. Check them again before submitting; they change.

Sources:

- https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md
- https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/.github/ISSUE_TEMPLATE/addition.md
- https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/.github/PULL_REQUEST_TEMPLATE.md

## Where entries live

The list on awesome-selfhosted.net and in the `awesome-selfhosted` README is generated from YAML files in the `awesome-selfhosted-data` repository. An addition is one pull request that adds one file:

> Create a new `software/software-name.yml` file, based on the template in .github/ISSUE_TEMPLATES/addition.md. Please use kebab-case for file naming, for example, `my-awesome-software.yml`.
> Remove comments and unused optional fields
> Enter a descriptive commit message (such as `add My Awesome software`)

## The rules that matter for Shotstash

From the pull request template (every box must be true and checked):

> - Submit one item per pull request. This eases reviewing and speeds up inclusion.
> - The submission was done by a human, not a machine/LLM.
> - You have searched the repository for any relevant issues or PRs, including closed ones.
> - Any software you are adding is not already listed at any of awesome-sysadmin, staticgen.com, staticsitegenerators.bevry.me, dbdb.io.
> - The file you are adding is formatted as described in addition.md.
> - `Demo` links should only be used for interactive demos, i.e. not video demonstrations. If login credentials are required to access the demo, please link to the credentials directly.
> - Comments and unused optional fields have been removed.
> - The file you are adding uses kebab-case file naming, for example `my-awesome-software.yml`.
> - Values for `platform` should match the platforms required to install and run the software.
> - Any software project you are adding to the list is actively maintained.
> - Any software project you are adding was first released more than 4 months ago.
> - Any software project you are adding has working installation instructions.
> - You understand that your Pull Request will be merged at least ~1 week after approval, depending on maintainers time.

On the age rule, CONTRIBUTING.md adds:

> Currently, this project has a release, but it is not yet 4 months old. Our guidelines require that Any software project you are adding was first released more than 4 months ago. This count initiates only after a release has been created to ensure users need not rely on the latest development version to use the project.

And on curation:

> Software with no development activity for 6-12 months may be removed from the list

## What this means for us

1. **Not on launch day.** The clock starts with the first tagged release (v0.2.0, the release PR merged on launch day). Shotstash becomes eligible four months after that release's date: first release on `<date>`, eligible from `<date + 4 months>`. Put the date in [schedule.md](schedule.md) once the release exists.
2. **The submission is the maintainer's own.** The list asks for a submission made by a human and for that attestation to be true, and its contribution guide asks that tools not write the entry or the pull request text for someone to post as their own. So there is deliberately no ready-made entry or PR text here: the maintainer writes the file from `addition.md` and submits it personally.
3. **Facts to have at hand** when writing it (from the template's field list, all checked against the list's own files on 2026-10-07):
   - required fields: `name`, `website_url`, `source_code_url`, `description` (under 250 characters, sentence case), `licenses`, `platforms`, `tags`;
   - optional fields: `depends_3rdparty`, `demo_url`, `related_software_url`;
   - license identifier: `MIT`;
   - platforms that exist in the list and match how Shotstash installs: `Docker`, `Nodejs`;
   - the closest existing tag: `Media Management` (other tags are listed in the data repository's `tags/` folder);
   - website: the docs site; source: the GitHub repository; demo: the interactive read-only demo, with its sign-in page showing the credentials (the template asks that credentials be reachable directly);
   - keep the description in the positioning: a media cloud for creators, never a general file store.
4. **Before submitting:** the project must look maintained (recent commits and releases), the README install must work for an outside person (see [validation.md](validation.md)), and nothing similar should already be pending in their issues or pull requests.
