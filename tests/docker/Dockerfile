FROM node:24-trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fd-find gh git just ripgrep \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/opt/pnpm
ENV COREPACK_HOME=/opt/corepack
ENV PATH=$PNPM_HOME/bin:$PNPM_HOME:$PATH
ENV HOME=/tmp/home
RUN corepack enable \
  && corepack install --global pnpm@12.16.1 \
  && mkdir -p /tmp/warm && cd /tmp/warm && echo '{"scripts":{"warm":"true"}}' > package.json && pnpm run warm \
  && rm -rf /tmp/warm \
  && chmod -R a+rX /opt/corepack
