import fs from 'node:fs';
import path from 'node:path';

// ─── 扫描结果类型定义 ───

export type ProjectKind = 'java-maven' | 'java-gradle' | 'node-npm' | 'node-tsx' | 'python' | 'go' | 'unknown';

export interface ProjectType {
  kind: ProjectKind;
  language: string;
  buildTool: string;
  evidence: string[];
}

export interface Dependency {
  name: string;
  version: string;
  scope?: string;
  group?: string;
}

export interface TechStackInfo {
  language: string;
  frameworks: string[];
  buildTool: string;
  runtime: string;
  dependencies: Dependency[];
}

export type LayerKind = 'controller' | 'service' | 'repository' | 'model' | 'config' | 'util' | 'dto' | 'other';

export interface LayerInfo {
  name: string;
  path: string;
  fileCount: number;
  kind: LayerKind;
}

export interface EntryPoint {
  file: string;
  symbol: string;
  line: number;
  kind: string;
}

export interface ArchitectureInfo {
  topDirs: string[];
  layers: LayerInfo[];
  entryPoints: EntryPoint[];
  sourceRoots: string[];
}

export interface ExternalApiInfo {
  name: string;
  url?: string;
  method?: string;
  file: string;
  line: number;
  source: 'feign' | 'rest-template' | 'fetch' | 'axios' | 'http-annotation' | 'url-literal';
}

export interface DataTableField {
  name: string;
  type?: string;
}

export interface DataTableInfo {
  name: string;
  file: string;
  line: number;
  fields: DataTableField[];
  source: 'sql-file' | 'jpa-entity' | 'mybatis-xml';
}

export interface KeyClassInfo {
  className: string;
  stereotype: string;
  file: string;
  line: number;
  annotations: string[];
  language: 'java' | 'typescript' | 'javascript' | 'unknown';
}

export interface SdkInfo {
  name: string;
  version: string;
  purpose: 'middleware' | 'utility' | 'framework' | 'test' | 'unknown';
  note?: string;
}

export interface ScanStats {
  filesScanned: number;
  durationMs: number;
  byExtension: Record<string, number>;
  skippedDirs: string[];
}

export interface ProjectScanResult {
  projectRoot: string;
  projectType: ProjectType;
  techStack: TechStackInfo;
  architecture: ArchitectureInfo;
  externalApis: ExternalApiInfo[];
  dataTables: DataTableInfo[];
  keyClasses: KeyClassInfo[];
  sdks: SdkInfo[];
  businessHints: string[];
  stats: ScanStats;
}

// ─── 常量配置 ───

const SKIP_DIRS = new Set<string>([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'target',
  '.idea', '.vscode', 'out', 'bin', '.cache', 'coverage',
  '.next', '.nuxt', '.turbo', '__pycache__', '.pytest_cache',
  '.gradle', '.mvn', 'venv', 'env', '.venv', '.x-spec',
]);

const SOURCE_EXTENSIONS = new Set<string>(['.java', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.kt', '.scala']);
const SQL_EXTENSIONS = new Set<string>(['.sql']);

// Java 分层目录关键词映射
const LAYER_PATTERNS: Array<{ regex: RegExp; kind: LayerKind }> = [
  { regex: /controller|api\b|web\b/i, kind: 'controller' },
  { regex: /service\b|biz\b|business\b/i, kind: 'service' },
  { regex: /repository|dao\b|mapper\b|persistence/i, kind: 'repository' },
  { regex: /model|entity|domain|pojo/i, kind: 'model' },
  { regex: /dto\b|vo\b|request|response/i, kind: 'dto' },
  { regex: /config|conf\b|configuration/i, kind: 'config' },
  { regex: /util|common|helper|support/i, kind: 'util' },
];

// 关键类识别正则（Java）
const JAVA_STEREOTYPE_PATTERNS: Array<{ stereotype: string; pattern: RegExp }> = [
  { stereotype: 'RestController', pattern: /@RestController\b/ },
  { stereotype: 'Controller', pattern: /@Controller\b(?!Advice)/ },
  { stereotype: 'Service', pattern: /@Service\b/ },
  { stereotype: 'Repository', pattern: /@Repository\b/ },
  { stereotype: 'Component', pattern: /@Component\b/ },
  { stereotype: 'Configuration', pattern: /@Configuration\b/ },
  { stereotype: 'Entity', pattern: /@Entity\b/ },
  { stereotype: 'Mapper', pattern: /@Mapper\b/ },
];

// Java class 声明提取
const JAVA_CLASS_PATTERN = /(?:public\s+|abstract\s+|final\s+)*class\s+([A-Z]\w+)/;
const JAVA_PACKAGE_PATTERN = /package\s+([\w.]+)\s*;/;

// TS/JS 关键类识别
const TS_STEREOTYPE_PATTERNS: Array<{ stereotype: string; pattern: RegExp }> = [
  { stereotype: 'Controller', pattern: /@(Controller|RestController|Get|Post|Put|Delete|Patch)\b/ },
  { stereotype: 'Module', pattern: /@Module\b/ },
  { stereotype: 'Injectable', pattern: /@Injectable\b/ },
  { stereotype: 'Entity', pattern: /@Entity\b/ },
];

// URL 字面量
const URL_LITERAL_PATTERN = /https?:\/\/[^\s'"`<>)]+/g;

// CREATE TABLE
const CREATE_TABLE_PATTERN = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?(\w+)[`"\]]?/gi;

// SQL 字段定义（简易）
const SQL_FIELD_PATTERN = /^\s*[`"\[]?(\w+)[`"\]]?\s+(?:VARCHAR|TEXT|INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|BOOLEAN|DATETIME|TIMESTAMP|DATE|TIME|CHAR|JSON|BLOB|CLOB|UUID)\b(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?/im;

// @FeignClient
const FEIGN_PATTERN = /@FeignClient\s*\(\s*(?:name|value)\s*=\s*"([^"]+)"/g;
// RestTemplate / WebClient 调用
const REST_TEMPLATE_PATTERN = /\.(?:getForObject|postForObject|exchange|getForEntity|postForEntity|put|delete)\s*\(\s*["']([^"']+)["']/g;

// JPA @Table
const JPA_TABLE_PATTERN = /@Table\s*\(\s*name\s*=\s*"([^"]+)"/;

// ─── 工具函数 ───

function listDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !SKIP_DIRS.has(d.name) && !d.name.startsWith('.'))
      .map(d => d.name);
  } catch {
    return [];
  }
}

function walkDir(
  dir: string,
  onFile: (filePath: string, relPath: string, ext: string) => void,
  stats: ScanStats,
  projectRoot: string,
  depth = 0,
  maxDepth = 12,
): void {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        stats.skippedDirs.push(path.relative(projectRoot, fullPath));
        continue;
      }
      walkDir(fullPath, onFile, stats, projectRoot, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ext) continue;
      stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;
      const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
      onFile(fullPath, relPath, ext);
      stats.filesScanned++;
    }
  }
}

function readLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  } catch {
    return [];
  }
}

// ─── 项目类型识别 ───

function detectProjectType(root: string): ProjectType {
  const evidence: string[] = [];

  if (fs.existsSync(path.join(root, 'pom.xml'))) {
    evidence.push('pom.xml found');
    return { kind: 'java-maven', language: 'Java', buildTool: 'Maven', evidence };
  }
  if (fs.existsSync(path.join(root, 'build.gradle')) || fs.existsSync(path.join(root, 'build.gradle.kts'))) {
    evidence.push('build.gradle found');
    return { kind: 'java-gradle', language: 'Java/Kotlin', buildTool: 'Gradle', evidence };
  }
  if (fs.existsSync(path.join(root, 'package.json'))) {
    const hasTsx = fs.existsSync(path.join(root, 'tsconfig.json'));
    evidence.push('package.json found');
    if (hasTsx) evidence.push('tsconfig.json found');
    return {
      kind: hasTsx ? 'node-tsx' : 'node-npm',
      language: hasTsx ? 'TypeScript' : 'JavaScript',
      buildTool: 'npm',
      evidence,
    };
  }
  if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'))) {
    evidence.push('requirements.txt/pyproject.toml found');
    return { kind: 'python', language: 'Python', buildTool: 'pip', evidence };
  }
  if (fs.existsSync(path.join(root, 'go.mod'))) {
    evidence.push('go.mod found');
    return { kind: 'go', language: 'Go', buildTool: 'go mod', evidence };
  }
  return { kind: 'unknown', language: '未知', buildTool: '未知', evidence };
}

// ─── 技术栈解析 ───

function parseMavenDeps(pomPath: string): Dependency[] {
  const content = fs.readFileSync(pomPath, 'utf-8');
  const deps: Dependency[] = [];
  const depBlockPattern = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]*)<\/version>)?(?:\s*<scope>([^<]*)<\/scope>)?\s*<\/dependency>/g;
  let match: RegExpExecArray | null;
  while ((match = depBlockPattern.exec(content)) !== null) {
    deps.push({
      group: match[1].trim(),
      name: match[2].trim(),
      version: (match[3] || '').trim() || 'managed',
      scope: (match[4] || '').trim() || undefined,
    });
  }
  return deps;
}

function parsePackageJson(pkgPath: string): { deps: Dependency[]; frameworks: string[] } {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps: Dependency[] = [];
    const frameworks: string[] = [];
    const collect = (obj: Record<string, string> | undefined, scope: string) => {
      if (!obj) return;
      for (const [name, version] of Object.entries(obj)) {
        deps.push({ name, version, scope });
        if (/(react|vue|angular|next|nuxt|express|nest|fastify|koa|electron)/i.test(name)) {
          frameworks.push(`${name}@${version}`);
        }
      }
    };
    collect(pkg.dependencies, 'runtime');
    collect(pkg.devDependencies, 'dev');
    collect(pkg.peerDependencies, 'peer');
    return { deps, frameworks };
  } catch {
    return { deps: [], frameworks: [] };
  }
}

function parsePythonDeps(root: string): Dependency[] {
  const deps: Dependency[] = [];
  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const lines = readLines(reqPath);
    for (const line of lines) {
      const trimmed = line.trim().split('#')[0].trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*[=~><!]=?\s*([\w.]+)?/);
      if (match) {
        deps.push({ name: match[1], version: match[2] || 'unknown' });
      }
    }
  }
  return deps;
}

function detectSdkPurpose(name: string): SdkInfo['purpose'] {
  const lower = name.toLowerCase();
  if (/(redis|kafka|rabbit|rocketmq|pulsar|nacos|consul|zookeeper|elasticsearch|mongo|mysql|postgres|mybatis|jpa|hibernate|jdbc)/i.test(lower)) {
    return 'middleware';
  }
  if (/(junit|mockito|test|spec|chai|vitest|jest|pytest)/i.test(lower)) {
    return 'test';
  }
  if (/(spring|react|vue|angular|express|nest|fastify|koa|django|flask|gin|echo)/i.test(lower)) {
    return 'framework';
  }
  if (/(lombok|guava|hutool|lodash|moment|dayjs|fastjson|jackson|gson)/i.test(lower)) {
    return 'utility';
  }
  return 'unknown';
}

function buildSdkList(deps: Dependency[]): SdkInfo[] {
  return deps.map(d => ({
    name: d.group ? `${d.group}:${d.name}` : d.name,
    version: d.version,
    purpose: detectSdkPurpose(d.name),
  }));
}

// ─── Java 源码扫描 ───

function scanJavaFile(filePath: string, relPath: string, result: ProjectScanResult): void {
  const lines = readLines(filePath);
  const annotationsByLine: Array<{ line: number; annotations: string[] }> = [];

  // 先收集每行的注解
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const found: string[] = [];
    for (const { stereotype, pattern } of JAVA_STEREOTYPE_PATTERNS) {
      if (pattern.test(line)) found.push(stereotype);
    }
    if (found.length > 0) {
      annotationsByLine.push({ line: i + 1, annotations: found });
    }
  }

  // 找 class 声明并与最近的注解关联
  for (let i = 0; i < lines.length; i++) {
    const classMatch = lines[i].match(JAVA_CLASS_PATTERN);
    if (!classMatch) continue;
    const className = classMatch[1];
    const classLine = i + 1;

    // 向上查找最近的注解（最多回溯5行）
    const relatedAnnotations: string[] = [];
    for (let j = annotationsByLine.length - 1; j >= 0; j--) {
      if (annotationsByLine[j].line <= classLine && classLine - annotationsByLine[j].line <= 5) {
        relatedAnnotations.push(...annotationsByLine[j].annotations);
        break;
      }
    }

    for (const stereotype of relatedAnnotations) {
      result.keyClasses.push({
        className,
        stereotype,
        file: relPath,
        line: classLine,
        annotations: relatedAnnotations,
        language: 'java',
      });
    }

    // 若该类带 @Entity，记录为数据表候选
    if (relatedAnnotations.includes('Entity')) {
      const tableMatch = lines.slice(Math.max(0, i - 5), i + 1).join('\n').match(JPA_TABLE_PATTERN);
      const tableName = tableMatch ? tableMatch[1] : className;
      const fields: DataTableField[] = [];
      for (let k = i + 1; k < Math.min(lines.length, i + 200); k++) {
        const fieldMatch = lines[k].match(/(?:private|protected|public)\s+([\w.<>]+)\s+(\w+)\s*;/);
        if (fieldMatch && /@(?:Column|Id)/.test(lines[k - 1] || '')) {
          fields.push({ name: fieldMatch[2], type: fieldMatch[1] });
        }
      }
      result.dataTables.push({
        name: tableName,
        file: relPath,
        line: classLine,
        fields,
        source: 'jpa-entity',
      });
    }
  }

  // @FeignClient 外部 API
  const fullContent = lines.join('\n');
  let feignMatch: RegExpExecArray | null;
  const feignPattern = new RegExp(FEIGN_PATTERN.source, 'g');
  while ((feignMatch = feignPattern.exec(fullContent)) !== null) {
    const lineNum = fullContent.slice(0, feignMatch.index).split('\n').length;
    result.externalApis.push({
      name: feignMatch[1],
      file: relPath,
      line: lineNum,
      source: 'feign',
    });
  }

  // RestTemplate / WebClient 调用
  const restPattern = new RegExp(REST_TEMPLATE_PATTERN.source, 'g');
  let restMatch: RegExpExecArray | null;
  while ((restMatch = restPattern.exec(fullContent)) !== null) {
    const lineNum = fullContent.slice(0, restMatch.index).split('\n').length;
    const url = restMatch[1];
    if (url.startsWith('http://') || url.startsWith('https://')) {
      result.externalApis.push({
        name: url,
        url,
        file: relPath,
        line: lineNum,
        source: 'rest-template',
      });
    }
  }
}

// ─── TS/JS 源码扫描 ───

function scanTsJsFile(filePath: string, relPath: string, result: ProjectScanResult): void {
  const lines = readLines(filePath);
  const content = lines.join('\n');

  // 类声明 + 装饰器
  for (let i = 0; i < lines.length; i++) {
    const classMatch = lines[i].match(/(?:export\s+)?(?:abstract\s+)?class\s+([A-Z]\w+)/);
    if (!classMatch) continue;
    const className = classMatch[1];
    const classLine = i + 1;
    const relatedAnnotations: string[] = [];
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      for (const { stereotype, pattern } of TS_STEREOTYPE_PATTERNS) {
        if (pattern.test(lines[j]) && !relatedAnnotations.includes(stereotype)) {
          relatedAnnotations.push(stereotype);
        }
      }
    }
    for (const stereotype of relatedAnnotations) {
      result.keyClasses.push({
        className,
        stereotype,
        file: relPath,
        line: classLine,
        annotations: relatedAnnotations,
        language: path.extname(filePath) === '.ts' || path.extname(filePath) === '.tsx' ? 'typescript' : 'javascript',
      });
    }
  }

  // fetch / axios 调用
  const fetchPattern = /\.(?:fetch|get|post|put|delete|patch|request)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
  let fetchMatch: RegExpExecArray | null;
  while ((fetchMatch = fetchPattern.exec(content)) !== null) {
    const url = fetchMatch[1];
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    const lineNum = content.slice(0, fetchMatch.index).split('\n').length;
    const isAxios = /\baxios\b/.test(lines[lineNum - 1] || '');
    result.externalApis.push({
      name: url,
      url,
      file: relPath,
      line: lineNum,
      source: isAxios ? 'axios' : 'fetch',
    });
  }

  // URL 字面量（限 http(s)）
  let urlMatch: RegExpExecArray | null;
  const urlPattern = new RegExp(URL_LITERAL_PATTERN.source, 'g');
  while ((urlMatch = urlPattern.exec(content)) !== null) {
    const url = urlMatch[0];
    // 跳过已被 fetch/axios 捕获的
    if (result.externalApis.some(a => a.file === relPath && a.url === url)) continue;
    const lineNum = content.slice(0, urlMatch.index).split('\n').length;
    result.externalApis.push({
      name: url,
      url,
      file: relPath,
      line: lineNum,
      source: 'url-literal',
    });
  }
}

// ─── SQL 文件扫描 ───

function scanSqlFile(filePath: string, relPath: string, result: ProjectScanResult): void {
  const lines = readLines(filePath);
  const content = lines.join('\n');

  const createPattern = new RegExp(CREATE_TABLE_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = createPattern.exec(content)) !== null) {
    const tableName = match[1];
    const tableLine = content.slice(0, match.index).split('\n').length;

    // 提取该表的字段（向后扫描到下一个 ; 或 CREATE TABLE）
    const afterMatch = content.slice(match.index);
    const endIndex = afterMatch.search(/;\s*(?:CREATE\s|ALTER\s|DROP\s|INSERT\s|$)/i);
    const tableBody = endIndex > 0 ? afterMatch.slice(0, endIndex) : afterMatch;
    const bodyLines = tableBody.split('\n');

    const fields: DataTableField[] = [];
    for (const bodyLine of bodyLines) {
      const fieldMatch = bodyLine.match(SQL_FIELD_PATTERN);
      if (fieldMatch && !/^(PRIMARY|FOREIGN|UNIQUE|KEY|CONSTRAINT|INDEX|CREATE)/i.test(bodyLine.trim())) {
        const parts = bodyLine.trim().split(/\s+/);
        fields.push({ name: parts[0].replace(/[`"\[\]]/g, ''), type: parts[1]?.replace(/\(.*$/, '') });
      }
    }

    result.dataTables.push({
      name: tableName,
      file: relPath,
      line: tableLine,
      fields,
      source: 'sql-file',
    });
  }
}

// ─── MyBatis XML 扫描 ───

function scanMyBatisXml(filePath: string, relPath: string, result: ProjectScanResult): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!/<mapper\b/i.test(content) && !/<select\b|<insert\b|<update\b|<delete\b/i.test(content)) return;

  // 提取涉及的表名
  const tableRefPattern = /\b(?:from|into|update|join)\s+([a-z_][\w.]*)/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = tableRefPattern.exec(content)) !== null) {
    const tableName = match[1].split('.').pop() || match[1];
    if (seen.has(tableName)) continue;
    seen.add(tableName);
    const lineNum = content.slice(0, match.index).split('\n').length;
    result.dataTables.push({
      name: tableName,
      file: relPath,
      line: lineNum,
      fields: [],
      source: 'mybatis-xml',
    });
  }
}

// ─── 入口点识别 ───

function detectEntryPoints(root: string, kind: ProjectKind): EntryPoint[] {
  const entries: EntryPoint[] = [];

  if (kind === 'java-maven' || kind === 'java-gradle') {
    walkSimple(root, (fullPath, relPath) => {
      if (!fullPath.endsWith('.java')) return;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const m = content.match(/public\s+(?:static\s+)?(?:void\s+main|class\s+(\w+Application))/);
      if (m && /@SpringBootApplication/.test(content)) {
        const line = content.slice(0, m.index || 0).split('\n').length;
        entries.push({ file: relPath, symbol: m[1] || 'main', line, kind: 'spring-boot-main' });
      }
    });
  } else if (kind === 'node-npm' || kind === 'node-tsx') {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const mainField = pkg.main || (pkg.bin && typeof pkg.bin === 'object' ? Object.values(pkg.bin)[0] : pkg.bin) || 'index.js';
        const mainPath = path.join(root, mainField as string);
        if (fs.existsSync(mainPath)) {
          entries.push({ file: mainField as string, symbol: 'main', line: 1, kind: 'node-entry' });
        }
        if (pkg.scripts && pkg.scripts.start) {
          entries.push({ file: 'package.json', symbol: `npm start → ${pkg.scripts.start}`, line: 1, kind: 'npm-script' });
        }
      } catch {
        // ignore
      }
    }
  } else if (kind === 'python') {
    walkSimple(root, (fullPath, relPath) => {
      if (!fullPath.endsWith('.py')) return;
      const content = fs.readFileSync(fullPath, 'utf-8');
      const m = content.match(/if\s+__name__\s*==\s*['"]__main__['"]/);
      if (m) {
        const line = content.slice(0, m.index || 0).split('\n').length;
        entries.push({ file: relPath, symbol: '__main__', line, kind: 'python-main' });
      }
    });
  }

  return entries;
}

function walkSimple(root: string, cb: (fullPath: string, relPath: string) => void, depth = 0): void {
  if (depth > 10) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walkSimple(fullPath, cb, depth + 1);
    } else if (entry.isFile()) {
      cb(fullPath, path.relative(root, fullPath).replace(/\\/g, '/'));
    }
  }
}

// ─── 架构与分层识别 ───

function detectArchitecture(root: string, kind: ProjectKind): ArchitectureInfo {
  const topDirs = listDirSafe(root);
  const sourceRoots: string[] = [];

  if (kind === 'java-maven' || kind === 'java-gradle') {
    const srcMain = path.join(root, 'src', 'main', 'java');
    if (fs.existsSync(srcMain)) sourceRoots.push('src/main/java');
    const srcMainKotlin = path.join(root, 'src', 'main', 'kotlin');
    if (fs.existsSync(srcMainKotlin)) sourceRoots.push('src/main/kotlin');
  } else if (kind === 'node-npm' || kind === 'node-tsx') {
    if (fs.existsSync(path.join(root, 'src'))) sourceRoots.push('src');
    if (fs.existsSync(path.join(root, 'app'))) sourceRoots.push('app');
    if (fs.existsSync(path.join(root, 'lib'))) sourceRoots.push('lib');
  } else if (kind === 'python') {
    for (const d of topDirs) {
      if (fs.existsSync(path.join(root, d, '__init__.py'))) sourceRoots.push(d);
    }
  }

  // 在源码根下递归找分层目录
  const layers: LayerInfo[] = [];
  const layerSeen = new Set<string>();
  for (const srcRoot of sourceRoots) {
    const srcAbs = path.join(root, srcRoot);
    walkForLayers(srcAbs, srcRoot, layers, layerSeen);
  }

  return { topDirs, layers, entryPoints: [], sourceRoots };
}

function walkForLayers(dir: string, relRoot: string, layers: LayerInfo[], seen: Set<string>, depth = 0): void {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

    const layerKind = LAYER_PATTERNS.find(p => p.regex.test(entry.name))?.kind;
    if (layerKind) {
      const relPath = path.join(relRoot, entry.name).replace(/\\/g, '/');
      if (!seen.has(relPath)) {
        seen.add(relPath);
        const fileCount = countSourceFiles(path.join(dir, entry.name));
        layers.push({ name: entry.name, path: relPath, fileCount, kind: layerKind });
      }
    }
    walkForLayers(path.join(dir, entry.name), relRoot, layers, seen, depth + 1);
  }
}

function countSourceFiles(dir: string): number {
  let count = 0;
  walkSimple(dir, (fullPath) => {
    if (SOURCE_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) count++;
  });
  return count;
}

// ─── 业务线索提取 ───

function extractBusinessHints(result: ProjectScanResult): string[] {
  const hints = new Set<string>();
  for (const cls of result.keyClasses) {
    // 从类名提取领域名词（去掉 Service/Controller/Repository 等后缀）
    const cleaned = cls.className
      .replace(/(Service|Controller|RestController|Repository|Mapper|Entity|Component|Configuration|Impl|Factory|Provider|Handler|Listener|Manager)$/, '');
    if (cleaned.length >= 3) hints.add(cleaned);
  }
  for (const layer of result.architecture.layers) {
    if (layer.kind === 'service' || layer.kind === 'controller' || layer.kind === 'model') {
      hints.add(layer.name);
    }
  }
  return Array.from(hints).slice(0, 30);
}

// ─── 主扫描入口 ───

export function scanProject(projectRoot: string): ProjectScanResult {
  const startTime = Date.now();
  const result: ProjectScanResult = {
    projectRoot,
    projectType: { kind: 'unknown', language: '未知', buildTool: '未知', evidence: [] },
    techStack: { language: '未知', frameworks: [], buildTool: '未知', runtime: '未知', dependencies: [] },
    architecture: { topDirs: [], layers: [], entryPoints: [], sourceRoots: [] },
    externalApis: [],
    dataTables: [],
    keyClasses: [],
    sdks: [],
    businessHints: [],
    stats: { filesScanned: 0, durationMs: 0, byExtension: {}, skippedDirs: [] },
  };

  // 1. 项目类型识别
  result.projectType = detectProjectType(projectRoot);
  const kind = result.projectType.kind;
  result.techStack.language = result.projectType.language;
  result.techStack.buildTool = result.projectType.buildTool;
  result.techStack.runtime = kind === 'java-maven' ? 'JVM' : kind === 'node-npm' || kind === 'node-tsx' ? 'Node.js' : kind === 'python' ? 'CPython' : kind === 'go' ? 'Go runtime' : '未知';

  // 2. 依赖解析
  let deps: Dependency[] = [];
  let frameworks: string[] = [];
  if (kind === 'java-maven') {
    deps = parseMavenDeps(path.join(projectRoot, 'pom.xml'));
    frameworks = deps
      .filter(d => /spring/i.test(d.name))
      .map(d => `${d.name}@${d.version}`);
  } else if (kind === 'node-npm' || kind === 'node-tsx') {
    const parsed = parsePackageJson(path.join(projectRoot, 'package.json'));
    deps = parsed.deps;
    frameworks = parsed.frameworks;
  } else if (kind === 'python') {
    deps = parsePythonDeps(projectRoot);
    frameworks = deps
      .filter(d => /(django|flask|fastapi|tornado)/i.test(d.name))
      .map(d => `${d.name}==${d.version}`);
  }
  result.techStack.dependencies = deps;
  result.techStack.frameworks = Array.from(new Set(frameworks));
  result.sdks = buildSdkList(deps);

  // 3. 架构识别
  result.architecture = detectArchitecture(projectRoot, kind);

  // 4. 源码扫描（关键类 / 外部API / 数据表）
  const stats = result.stats;
  walkDir(projectRoot, (fullPath, relPath, ext) => {
    if (ext === '.java' || ext === '.kt') scanJavaFile(fullPath, relPath, result);
    else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') scanTsJsFile(fullPath, relPath, result);
    else if (SQL_EXTENSIONS.has(ext)) scanSqlFile(fullPath, relPath, result);
    else if (ext === '.xml' && /mapper|mybatis|ibatis/i.test(relPath)) scanMyBatisXml(fullPath, relPath, result);
  }, stats, projectRoot);

  // 5. 入口点识别
  result.architecture.entryPoints = detectEntryPoints(projectRoot, kind);

  // 6. 业务线索
  result.businessHints = extractBusinessHints(result);

  // 7. 去重外部 API（同文件同行只保留一条）
  const apiSeen = new Set<string>();
  result.externalApis = result.externalApis.filter(a => {
    const key = `${a.file}:${a.line}:${a.url || a.name}`;
    if (apiSeen.has(key)) return false;
    apiSeen.add(key);
    return true;
  });

  result.stats.durationMs = Date.now() - startTime;
  return result;
}

// ─── Markdown 渲染 ───

function renderHeader(title: string, scan: ProjectScanResult): string {
  return `<!-- 由 x-spec init 自动扫描生成，可手动补充。最后扫描: ${new Date().toISOString().slice(0, 19)}Z, 耗时 ${scan.stats.durationMs}ms, 扫描 ${scan.stats.filesScanned} 个文件 -->\n\n# ${title}\n`;
}

export function renderArchitectureMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('代码架构索引', scan));
  lines.push(`## 项目类型\n`);
  lines.push(`- **类型**: ${scan.projectType.kind}`);
  lines.push(`- **语言**: ${scan.projectType.language}`);
  lines.push(`- **构建工具**: ${scan.projectType.buildTool}`);
  lines.push(`- **识别证据**: ${scan.projectType.evidence.join('; ') || '无'}\n`);

  lines.push(`## 顶层目录\n`);
  if (scan.architecture.topDirs.length === 0) {
    lines.push('- （未识别到顶层目录）\n');
  } else {
    for (const d of scan.architecture.topDirs) lines.push(`- \`${d}/\``);
    lines.push('');
  }

  lines.push(`## 源码根\n`);
  if (scan.architecture.sourceRoots.length === 0) {
    lines.push('- （未识别到源码根目录）\n');
  } else {
    for (const r of scan.architecture.sourceRoots) lines.push(`- \`${r}/\``);
    lines.push('');
  }

  lines.push(`## 分层结构\n`);
  if (scan.architecture.layers.length === 0) {
    lines.push('- （未识别到典型分层目录，可手动补充）\n');
  } else {
    lines.push('| 分层 | 路径 | 文件数 | 类型 |');
    lines.push('|------|------|--------|------|');
    for (const l of scan.architecture.layers) {
      lines.push(`| ${l.name} | \`${l.path}\` | ${l.fileCount} | ${l.kind} |`);
    }
    lines.push('');
  }

  lines.push(`## 入口点\n`);
  if (scan.architecture.entryPoints.length === 0) {
    lines.push('- （未识别到入口点）\n');
  } else {
    for (const e of scan.architecture.entryPoints) {
      lines.push(`- **${e.symbol}** (${e.kind}) — \`${e.file}:${e.line}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderTechStackMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('技术栈', scan));
  lines.push(`## 语言与运行时\n`);
  lines.push(`- **语言**: ${scan.techStack.language}`);
  lines.push(`- **运行时**: ${scan.techStack.runtime}`);
  lines.push(`- **构建工具**: ${scan.techStack.buildTool}\n`);

  lines.push(`## 框架\n`);
  if (scan.techStack.frameworks.length === 0) {
    lines.push('- （未识别到主流框架）\n');
  } else {
    for (const f of scan.techStack.frameworks) lines.push(`- ${f}`);
    lines.push('');
  }

  lines.push(`## 依赖清单（共 ${scan.techStack.dependencies.length} 项）\n`);
  if (scan.techStack.dependencies.length === 0) {
    lines.push('- （未解析到依赖）\n');
  } else {
    lines.push('| 名称 | 版本 | scope |');
    lines.push('|------|------|--------|');
    for (const d of scan.techStack.dependencies.slice(0, 200)) {
      lines.push(`| ${d.group ? d.group + ':' : ''}${d.name} | ${d.version} | ${d.scope || 'runtime'} |`);
    }
    if (scan.techStack.dependencies.length > 200) {
      lines.push(`| ... | ... | ${scan.techStack.dependencies.length - 200} 项已省略 |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function renderApiMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('外部 API 依赖', scan));
  lines.push(`## 已识别的外部 API 调用（共 ${scan.externalApis.length} 处）\n`);
  if (scan.externalApis.length === 0) {
    lines.push('- （未扫描到外部 API 调用，请手动补充第三方 API 端点、认证方式、SLA）\n');
  } else {
    lines.push('| 名称 / URL | 来源 | 文件 | 行号 |');
    lines.push('|------------|------|------|------|');
    for (const a of scan.externalApis.slice(0, 200)) {
      lines.push(`| ${a.url || a.name} | ${a.source} | \`${a.file}\` | ${a.line} |`);
    }
    if (scan.externalApis.length > 200) {
      lines.push(`| ... | ... | ... | ${scan.externalApis.length - 200} 项已省略 |`);
    }
    lines.push('');
  }

  lines.push(`## 认证方式\n<!-- 待人工补充 -->\n`);
  lines.push(`## SLA 与限制\n<!-- 待人工补充 -->\n`);
  return lines.join('\n');
}

export function renderBusinessMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('业务背景', scan));
  lines.push(`## 业务领域线索（自动从代码中提取，待人工确认）\n`);
  if (scan.businessHints.length === 0) {
    lines.push('- （未提取到业务线索，请手动补充业务领域描述）\n');
  } else {
    for (const h of scan.businessHints) lines.push(`- ${h}`);
    lines.push('');
  }
  lines.push(`## 核心业务流程\n<!-- 待人工补充 -->\n`);
  lines.push(`## 领域模型\n<!-- 待人工补充 -->\n`);
  lines.push(`## 业务规则\n<!-- 待人工补充 -->\n`);
  return lines.join('\n');
}

export function renderSchemaMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('关键数据表结构', scan));
  lines.push(`## 已识别的数据表（共 ${scan.dataTables.length} 张）\n`);
  if (scan.dataTables.length === 0) {
    lines.push('- （未扫描到数据表定义，可手动补充关键表结构）\n');
  } else {
    for (const t of scan.dataTables.slice(0, 50)) {
      lines.push(`### ${t.name}`);
      lines.push(`- **来源**: ${t.source}`);
      lines.push(`- **位置**: \`${t.file}:${t.line}\``);
      if (t.fields.length > 0) {
        lines.push(`- **字段**:`);
        lines.push('');
        lines.push('| 字段名 | 类型 |');
        lines.push('|--------|------|');
        for (const f of t.fields.slice(0, 30)) {
          lines.push(`| ${f.name} | ${f.type || '-'} |`);
        }
        lines.push('');
      } else {
        lines.push('- **字段**: （未提取，详见源文件）\n');
      }
    }
    if (scan.dataTables.length > 50) {
      lines.push(`> 另有 ${scan.dataTables.length - 50} 张表已省略\n`);
    }
  }
  return lines.join('\n');
}

export function renderClassIndexMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('关键类索引', scan));
  lines.push(`## 关键类清单（共 ${scan.keyClasses.length} 个）\n`);
  if (scan.keyClasses.length === 0) {
    lines.push('- （未扫描到带注解/约定命名的关键类）\n');
  } else {
    lines.push('| 类名 | 类型 | 文件 | 行号 | 语言 | 注解 |');
    lines.push('|------|------|------|------|------|------|');
    for (const c of scan.keyClasses.slice(0, 200)) {
      lines.push(`| ${c.className} | ${c.stereotype} | \`${c.file}\` | ${c.line} | ${c.language} | ${c.annotations.join(', ')} |`);
    }
    if (scan.keyClasses.length > 200) {
      lines.push(`| ... | ... | ... | ... | ... | ${scan.keyClasses.length - 200} 项已省略 |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderSdkMd(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(renderHeader('SDK 依赖', scan));
  const byPurpose = new Map<string, SdkInfo[]>();
  for (const s of scan.sdks) {
    const list = byPurpose.get(s.purpose) || [];
    list.push(s);
    byPurpose.set(s.purpose, list);
  }
  const order: SdkInfo['purpose'][] = ['middleware', 'framework', 'utility', 'test', 'unknown'];
  for (const purpose of order) {
    const list = byPurpose.get(purpose);
    if (!list || list.length === 0) continue;
    const label = { middleware: '中间件', framework: '框架', utility: '工具库', test: '测试', unknown: '其他' }[purpose];
    lines.push(`## ${label}（${list.length} 项）\n`);
    lines.push('| 名称 | 版本 |');
    lines.push('|------|------|');
    for (const s of list) lines.push(`| ${s.name} | ${s.version} |`);
    lines.push('');
  }
  if (scan.sdks.length === 0) {
    lines.push('- （未解析到 SDK 依赖）\n');
  }
  return lines.join('\n');
}

export function renderScanSummary(scan: ProjectScanResult): string {
  const lines: string[] = [];
  lines.push(`## 扫描统计\n`);
  lines.push(`- **项目类型**: ${scan.projectType.kind}`);
  lines.push(`- **扫描文件数**: ${scan.stats.filesScanned}`);
  lines.push(`- **耗时**: ${scan.stats.durationMs}ms`);
  lines.push(`- **关键类**: ${scan.keyClasses.length}`);
  lines.push(`- **数据表**: ${scan.dataTables.length}`);
  lines.push(`- **外部 API**: ${scan.externalApis.length}`);
  lines.push(`- **依赖总数**: ${scan.techStack.dependencies.length}`);
  lines.push(`- **跳过目录**: ${scan.stats.skippedDirs.length}`);
  return lines.join('\n');
}

// ─── Init 渲染模板相关 ───

/** 7 个 knowledge 索引文件名（key 与渲染函数一一对应） */
export const KNOWLEDGE_INDEX_KEYS = [
  'architecture',
  'tech-stack',
  'api',
  'business',
  'schema',
  'class-index',
  'sdk',
] as const;

export type KnowledgeIndexKey = typeof KNOWLEDGE_INDEX_KEYS[number];

/** 索引 key → 文件名（不含扩展名匹配） */
export const KNOWLEDGE_INDEX_FILENAMES: Record<KnowledgeIndexKey, string> = {
  'architecture': 'architecture.md',
  'tech-stack': 'tech-stack.md',
  'api': 'api.md',
  'business': 'business.md',
  'schema': 'schema.md',
  'class-index': 'class-index.md',
  'sdk': 'sdk.md',
};

/** 索引 key → 内置渲染函数 */
export const BUILTIN_RENDERERS: Record<KnowledgeIndexKey, (scan: ProjectScanResult) => string> = {
  'architecture': renderArchitectureMd,
  'tech-stack': renderTechStackMd,
  'api': renderApiMd,
  'business': renderBusinessMd,
  'schema': renderSchemaMd,
  'class-index': renderClassIndexMd,
  'sdk': renderSdkMd,
};

/** 索引 key → 中文标题（用于模板清单展示） */
export const KNOWLEDGE_INDEX_TITLES: Record<KnowledgeIndexKey, string> = {
  'architecture': '代码架构索引',
  'tech-stack': '技术栈',
  'api': '外部 API 依赖',
  'business': '业务背景',
  'schema': '关键数据表结构',
  'class-index': '关键类索引',
  'sdk': 'SDK 依赖',
};
