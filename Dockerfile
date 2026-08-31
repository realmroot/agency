FROM docker.io/cloudflare/sandbox:0.10.1

# GitHub CLI: agents authenticate via the session's GH_TOKEN env (repo-scoped
# App installation token) — no gh auth login required.
ARG GH_VERSION=2.94.0
RUN curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
  | tar -xz --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
  && gh --version

# Realmroot-bound cloud Sessions require Toolbox before Environment package
# installation. Cloudflare Sandbox currently runs linux/amd64, so keep the
# release asset and its independently pinned digest explicit.
ARG REALMROOT_VERSION=0.4.2
ARG REALMROOT_SHA256=51a7d0d8c99a748a4bec8b8778f34659f621952d70756151d726c8c4d480e5da
RUN set -eux; \
  asset="realmroot_${REALMROOT_VERSION}_linux_amd64.tar.gz"; \
  release="https://github.com/realmroot/cli/releases/download/v${REALMROOT_VERSION}"; \
  curl -fsSLo "/tmp/${asset}" "${release}/${asset}"; \
  cd /tmp; \
  echo "${REALMROOT_SHA256}  ${asset}" | sha256sum -c -; \
  tar -xzf "${asset}" -C /usr/local/bin realmroot; \
  chmod 0755 /usr/local/bin/realmroot; \
  rm -f "${asset}"; \
  realmroot version

# Cloud environments install other declared Go modules at Session startup.
ARG GO_VERSION=1.25.3
ARG GO_SHA256=0335f314b6e7bfe08c3d0cfaa7c19db961b7b99fb20be62b0a826c992ad14e0f
RUN curl -fsSLo /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
  && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/go.tar.gz -C /usr/local \
  && rm /tmp/go.tar.gz \
  && /usr/local/go/bin/go version
ENV PATH="/usr/local/go/bin:${PATH}"
