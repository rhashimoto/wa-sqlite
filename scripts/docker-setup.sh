curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
. $HOME/.cargo/env && \
rustup toolchain install nightly-2023-08-28-aarch64-unknown-linux-gnu && \
rustup component add rust-src --toolchain nightly-2023-08-28-aarch64-unknown-linux-gnu

sudo apt-get update -y
sudo apt-get install -y tclsh

# Need NVM:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc
nvm install 18.12.0 && nvm use 18.12.0
npm install -g yarn