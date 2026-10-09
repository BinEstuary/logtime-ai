# Stage 1: Build the Redmine CLI Go binary
FROM golang:1.25-alpine AS go-builder
WORKDIR /app
# Copy the redmine-cli source code
COPY redmine-cli-src/go.mod redmine-cli-src/go.sum ./
RUN go mod download
COPY redmine-cli-src/ ./
RUN go build -ldflags "-X main.version=k3s-dev" -o bin/redmine ./cmd/redmine

# Stage 2: Run the Vite dev server
FROM node:22-alpine
# Set working directory to match the hardcoded paths in the app
WORKDIR /home/binnguyen/Estuary/Test/logtime

# Install git, bash, or other dependencies if needed
RUN apk add --no-cache bash git

# Copy package files and install dependencies (Electron binary is only needed for desktop builds)
COPY package*.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm install

# Copy Vite source code
COPY . .

# Copy the compiled Go binary from Stage 1 to the path expected by vite.config.ts
RUN mkdir -p /home/binnguyen/.local/bin
COPY --from=go-builder /app/bin/redmine /home/binnguyen/.local/bin/redmine
ENV REDMINE_BIN=/home/binnguyen/.local/bin/redmine
# Container không đọc được lịch sử AI agent/hoạt động trên máy người dùng
ENV ENABLE_AGENT_HISTORY=0

# Expose Vite dev server port
EXPOSE 5173

# Run Vite dev server in host mode
CMD ["npm", "run", "dev", "--", "--host"]
