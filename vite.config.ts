import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-server',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // 1. GET Current Redmine configuration
          if (req.url === '/api/get-redmine' && req.method === 'GET') {
            try {
              const configPath = path.join(os.homedir(), '.redmine-cli.yaml');
              if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                const serverMatch = content.match(/server:\s*["']?([^"'\r\n]+)/);
                const apiKeyMatch = content.match(/api_key:\s*["']?([^"'\r\n]+)/);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                  success: true,
                  server: serverMatch ? serverMatch[1] : '',
                  apiKey: apiKeyMatch ? apiKeyMatch[1] : ''
                }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, server: '', apiKey: '' }));
              }
            } catch (e: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: false, error: e.message }));
            }
          }
          // 2. SAVE Redmine configuration & Update MCP Configs
          else if (req.url === '/api/save-redmine' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const configPath = path.join(os.homedir(), '.redmine-cli.yaml');
                
                // Write ~/.redmine-cli.yaml
                const yamlContent = `# redmine-cli configuration
default_profile: default
profiles:
  default:
    server: "${data.server}"
    api_key: "${data.apiKey}"
`;
                fs.writeFileSync(configPath, yamlContent.trim(), 'utf8');
                
                // Update MCP Server Configs in agent workspaces
                const mcpConfig = {
                  mcpServers: {
                    redmine: {
                      command: "/home/binnguyen/.local/bin/redmine",
                      args: ["mcp", "serve"],
                      env: {
                        "REDMINE_SERVER": data.server,
                        "REDMINE_API_KEY": data.apiKey,
                        "REDMINE_MCP_ENABLE_WRITES": "true"
                      }
                    }
                  }
                };
                
                const mcpPath1 = '/home/binnguyen/.gemini/antigravity/mcp_config.json';
                const mcpPath2 = '/home/binnguyen/.gemini/config/mcp_config.json';
                
                if (fs.existsSync(path.dirname(mcpPath1))) {
                  fs.writeFileSync(mcpPath1, JSON.stringify(mcpConfig, null, 2), 'utf8');
                }
                if (fs.existsSync(path.dirname(mcpPath2))) {
                  fs.writeFileSync(mcpPath2, JSON.stringify(mcpConfig, null, 2), 'utf8');
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
          }
          // 3. SYNC current tasks to workspace JSON (Bridge for AI in chat)
          else if (req.url === '/api/sync-workspace-tasks' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const filePath = path.join('/home/binnguyen/Estuary/Test/logtime', 'current_tasks.json');
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
          }
          // 4. POST single task LogTime to Redmine using local binary
          else if (req.url === '/api/redmine/log' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const { hours, comment, date, issue, project } = data;
                
                // Enforce weekend validation (0 = Sunday, 6 = Saturday)
                const [y, m, d] = date.split('-').map(Number);
                const dateObj = new Date(y, m - 1, d);
                const dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ success: false, error: 'Không được phép log time vào Thứ Bảy và Chủ Nhật!' }));
                  return;
                }
                
                let cmd = `/home/binnguyen/.local/bin/redmine time log --hours ${hours} --date ${date}`;
                const escapedComment = comment.replace(/"/g, '\\"');
                cmd += ` --comment "${escapedComment}"`;
                
                if (issue) {
                  cmd += ` --issue ${parseInt(issue, 10)}`;
                } else if (project) {
                  cmd += ` --project "${project}"`;
                }
                
                exec(cmd, (err, stdout, stderr) => {
                  if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: err.message, stderr }));
                  } else {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, stdout }));
                  }
                });
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
          }
          // 5. POST Search issues from Redmine
          else if (req.url === '/api/redmine/search' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const { query, assignee, status, limit } = data;
                let cmd = `/home/binnguyen/.local/bin/redmine issues list -o json`;
                if (query) {
                  const cleanQuery = query.replace(/'/g, "'\\''").replace(/"/g, '\\"');
                  cmd += ` --filter subject="~${cleanQuery}"`;
                }
                if (assignee) {
                  cmd += ` --assignee "${assignee}"`;
                }
                if (status) {
                  cmd += ` --status "${status}"`;
                } else {
                  cmd += ` --status "*"`;
                }
                if (typeof limit === 'number') {
                  cmd += ` --limit ${limit}`;
                } else {
                  cmd += ` --limit 100`;
                }
                
                exec(cmd, (err, stdout, _stderr) => {
                  if (err) {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify([])); // Fallback to empty array on error rather than breaking
                  } else {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(stdout || '[]');
                  }
                });
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
          }
          // 6. POST Create issue (subtask) on Redmine
          else if (req.url === '/api/redmine/create-issue' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body);
                const { project, parent, subject, description, estimatedHours } = data;
                
                if (!subject) {
                  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ success: false, error: 'Subject is required' }));
                  return;
                }
                
                let cmd = `/home/binnguyen/.local/bin/redmine issues create --subject "${subject.replace(/"/g, '\\"')}" --assignee me -o json`;
                if (project) {
                  cmd += ` --project "${project}"`;
                }
                if (parent) {
                  cmd += ` --parent ${parseInt(parent, 10)}`;
                }
                if (description) {
                  cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
                }
                if (estimatedHours) {
                  cmd += ` --estimated-hours ${parseFloat(estimatedHours)}`;
                }
                
                exec(cmd, (err, stdout, stderr) => {
                  if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: err.message, stderr }));
                  } else {
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(stdout);
                  }
                });
              } catch (e: any) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
          }
          // 7. GET/POST list of time entries on Redmine (user is me)
          else if (req.url === '/api/redmine/time-entries' && (req.method === 'GET' || req.method === 'POST')) {
            let cmd = `/home/binnguyen/.local/bin/redmine time list -o json --user me --limit 150`;
            exec(cmd, (err, stdout, stderr) => {
              if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: err.message, stderr }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(stdout || '[]');
              }
            });
          }
          else {
            next();
          }
        });
      }
    }
  ],
  server: {
    proxy: {
      '/api-z': {
        target: 'https://api.z.ai/api/paas/v4',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-z/, '')
      }
    }
  }
})
