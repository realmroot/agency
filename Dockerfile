FROM docker.io/cloudflare/sandbox:0.10.1

# GitHub CLI: agents authenticate via the session's GH_TOKEN env (repo-scoped
# App installation token) — no gh auth login required.
ARG GH_VERSION=2.94.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
  | tar -xz --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && gh --version

# Cloud environments install their declared Go modules at Session startup.
# Keep only the generic installer toolchain in the image; tools such as
# Realmroot belong to Environment packages rather than the runtime host.
ARG GO_VERSION=1.25.3
ARG GO_SHA256=0335f314b6e7bfe08c3d0cfaa7c19db961b7b99fb20be62b0a826c992ad14e0f
RUN curl -fsSLo /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
  && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/go.tar.gz -C /usr/local \
  && rm /tmp/go.tar.gz \
  && /usr/local/go/bin/go version
ENV PATH="/usr/local/go/bin:${PATH}"
