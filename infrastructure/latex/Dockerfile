FROM debian:bookworm-slim@sha256:362e64223cc0da95422b3b13c045186fc0a81250e765d31c025fbddf257f6143

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    lmodern \
    texlive-fonts-recommended \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-latex-recommended \
    texlive-xetex \
  && rm -rf /var/lib/apt/lists/*

COPY compile-report /usr/local/bin/compile-report
RUN chmod 0555 /usr/local/bin/compile-report

USER 65532:65532
ENTRYPOINT ["/usr/local/bin/compile-report"]
