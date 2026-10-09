#!/bin/bash
set -e

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== 1. Building Docker image ===${NC}"
docker build -t logtime:latest .

echo -e "${BLUE}=== 2. Importing image into K3s containerd ===${NC}"
# K3s uses containerd with the 'k8s.io' namespace for Kubernetes pods.
# We save the docker image and import it directly into K3s's containerd.
docker save logtime:latest | sudo k3s ctr -n k8s.io images import -

echo -e "${BLUE}=== 3. Deploying to K3s ===${NC}"
# We use 'sudo k3s kubectl' to ensure it uses the correct system kubeconfig (/etc/rancher/k3s/k3s.yaml)
sudo k3s kubectl apply -f k8s/deployment.yaml

echo -e "${BLUE}=== 4. Checking deployment status ===${NC}"
sudo k3s kubectl rollout status deployment/logtime-app

echo -e "${GREEN}=== Deployment completed successfully! ===${NC}"
echo -e "${YELLOW}Please ensure you have added '127.0.0.1 logtime.estuary' to your /etc/hosts file.${NC}"
echo -e "${YELLOW}You can access the app at: http://logtime.estuary${NC}"
echo -e "To view pod status: ${BLUE}sudo k3s kubectl get pods -l app=logtime${NC}"
echo -e "To view logs: ${BLUE}sudo k3s kubectl logs -l app=logtime -f${NC}"
echo -e "To check ingress: ${BLUE}sudo k3s kubectl get ingress logtime-ingress${NC}"
