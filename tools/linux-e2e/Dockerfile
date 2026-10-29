FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8 AS builder
USER root
COPY scripts/linux_e2e_image.py /recipe/scripts/linux_e2e_image.py
COPY config/desktop/linux-e2e-build.json /recipe/config/desktop/linux-e2e-build.json
COPY config/desktop/linux-e2e-build.json /opt/ohtia-build-context.json
RUN python3 /recipe/scripts/linux_e2e_image.py prepare
RUN python3 /recipe/scripts/linux_e2e_image.py compile
RUN python3 /recipe/scripts/linux_e2e_image.py finalize

FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:d65108d1a8095d8b0c4a5e32bf1807a40a5ce90ff0c78473e1116b1c243235e8
USER root
COPY --from=builder /opt/installed /opt/installed
COPY --from=builder /opt/ohtia-image /opt/ohtia-image
COPY --from=builder /etc/apt/sources.list /etc/apt/sources.list
RUN export DEBIAN_FRONTEND=noninteractive && rm -f /etc/apt/sources.list.d/* && apt-get update && xargs -r apt-get install -y --no-install-recommends < /opt/ohtia-image/runtime-packages.txt && rm -rf /var/lib/apt/lists/*
COPY --from=builder /opt/ohtia-webkit-launch /ms-playwright/webkit-2370/pw_run.sh
USER pwuser
WORKDIR /home/pwuser
