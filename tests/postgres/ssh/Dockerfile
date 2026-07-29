FROM alpine:3.21

RUN apk add --no-cache openssh-server \
    && adduser -D -s /bin/sh plume \
    && mkdir -p /run/sshd

COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /usr/local/bin/plume-sshd

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/plume-sshd"]
