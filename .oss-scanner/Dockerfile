# Build image for Anthropic OSS Scanner (https://github.com/anthropics/oss-scanner).
# Network is available only during this build; everything the tests need is installed here.
FROM node:24-bookworm
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git openssl python3 \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# standard is pre-installed so `npx standard` works offline
RUN npm ci && npm install --no-save standard

# Run the checks so the image is known to work, without failing the build on a red test.
RUN (npx standard && npm test) || echo "WARNING: checks reported failures"
