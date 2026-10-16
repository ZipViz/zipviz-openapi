# Contributing to the ZipViz Registry API specification

This repository holds the OpenAPI description of the public ZipViz Registry API. It describes what
the live API does, so a change here must match the API's actual behavior.

## Before you open a pull request

- **Contributor License Agreement.** We can only merge a contribution after its author has signed
  the ZipViz Individual Contributor License Agreement (ICLA). If you contribute as part of your
  job, your employer may also need to sign a Corporate CLA.
- **Security issues are never reported in public.** Do not open an issue or pull request for a
  suspected vulnerability. Follow [SECURITY.md](SECURITY.md) instead.
- **No secrets or personal data** in the specification, examples, issues or pull requests.

## Pull requests

- If the specification disagrees with the live API, open an issue with the request and the
  response you saw (with any keys, tokens or personal data removed).
- Keep each pull request to one change, and check that `openapi.json` is still a valid OpenAPI
  3.1 document.
- CI runs a full-history secret scan and must pass. A maintainer reviews every pull request, and
  only maintainers merge.

## Names

The specification is licensed under Apache-2.0. As section 6 of that license says, it does not
grant permission to use the ZipViz name or marks.
