import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function getLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ProvidersConfig {
  [provider: string]: string[];
}

let loadedProvidersConfig: ProvidersConfig | null = null;
let lastConfigReadTime = 0;

export function getProvidersConfig(): ProvidersConfig {
  const now = Date.now();
  if (loadedProvidersConfig && (now - lastConfigReadTime < 5000)) {
    return loadedProvidersConfig;
  }

  const configPath = path.join(os.homedir(), '.llm-usage-tracker', 'providers.json');
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      loadedProvidersConfig = JSON.parse(content);
      lastConfigReadTime = now;
      return loadedProvidersConfig!;
    }
  } catch (e) {
    console.error('Failed to load providers.json:', e);
  }

  loadedProvidersConfig = {
    anthropic: ['claude-'],
    openai: ['gpt-', 'o1-', 'o3-', 'text-embedding-'],
    gemini: ['gemini-'],
    deepseek: ['deepseek-'],
    moonshot: ['kimi-', 'moonshot-'],
    zhipu: ['glm-', 'chatglm'],
    qwen: ['qwen-', 'qwen'],
    minimax: ['minimax-']
  };
  lastConfigReadTime = now;

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(loadedProvidersConfig, null, 2), 'utf-8');
  } catch(e) {}

  return loadedProvidersConfig!;
}
