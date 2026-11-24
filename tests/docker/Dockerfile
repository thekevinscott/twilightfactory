FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fd-find gh git just ripgrep \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/opt/pnpm
ENV COREPACK_HOME=/opt/corepack
ENV PATH=$PNPM_HOME/bin:$PNPM_HOME:$PATH
RUN corepack enable \
  && pnpm add --global @earendil-works/pi-coding-agent@1.3.0 \
  && chmod -R a+rX /opt/pnpm /opt/corepack
ENV HOME=/tmp/home
