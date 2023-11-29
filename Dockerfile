FROM mcr.microsoft.com/devcontainers/base:bullseye

# Need Chrome: 
RUN sudo apt update 
RUN sudo apt install chromium clang default-jre -y


COPY ./scripts/docker-setup.sh /tmp/setup.sh

RUN sudo /bin/bash /tmp/setup.sh