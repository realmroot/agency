FROM docker.io/cloudflare/sandbox:0.10.1

# GitHub CLI: agents authenticate via the session's GH_TOKEN env (repo-scoped
# App installation token) — no gh auth login required.
ARG GH_VERSION=2.94.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
  | tar -xz --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && gh --version

# Realmroot is pinned and checksum-verified so every cloud Session exposes the
# same Toolbox contract. Agent state is mounted separately at Session start.
ARG REALMROOT_VERSION=0.4.2
ARG REALMROOT_SHA256=51a7d0d8c99a748a4bec8b8778f34659f621952d70756151d726c8c4d480e5da
RUN curl -fsSLo /tmp/realmroot.tar.gz \
    "https://github.com/realmroot/cli/releases/download/v${REALMROOT_VERSION}/realmroot_${REALMROOT_VERSION}_linux_amd64.tar.gz" \
  && echo "${REALMROOT_SHA256}  /tmp/realmroot.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/realmroot.tar.gz -C /usr/local/bin realmroot \
  && rm /tmp/realmroot.tar.gz \
  && realmroot version
