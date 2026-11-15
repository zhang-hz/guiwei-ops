import fs from 'node:fs/promises';
import path from 'node:path';
import { NODE_VERSION, object, requireThat, textValue } from '../core.mjs';
import { noLinks, readJson } from '../filesystem.mjs';
import { boundedProcess, processSucceeded } from '../process.mjs';

export async function loadRuntime(controlRoot) {
  const runtime = await readJson(path.join(controlRoot, 'ci/runtime.json'), 16384);
  object(runtime, ['schemaVersion', 'nodeVersion', 'dockerExecutable', 'image', 'imageId', 'runnerLabel']);
  requireThat(runtime.schemaVersion === 1 && runtime.nodeVersion === NODE_VERSION && runtime.runnerLabel === 'ubuntu-24.04', '运行环境配置不兼容', 10);
  requireThat(runtime.dockerExecutable === '/usr/bin/docker', 'Docker入口不在控制白名单', 10);
  requireThat(typeof runtime.image === 'string' && /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/u.test(runtime.image), '缺少经审核固定的运行镜像digest', 10);
  requireThat(/^sha256:[a-f0-9]{64}$/u.test(runtime.imageId), '镜像配置内容身份无效', 10);
  return runtime;
}

export async function verifyRuntime(runtime, command) {
  requireThat(process.platform === 'linux', '该平台没有M1所需Linux容器隔离', 10);
  const release = await fs.readFile('/etc/os-release', 'utf8');
  requireThat(/^ID=ubuntu$/mu.test(release) && /^VERSION_ID="24\.04"$/mu.test(release), 'M1正式隔离宿主必须是Ubuntu24.04', 10);
  await noLinks(runtime.dockerExecutable);
  const executable = await fs.stat(runtime.dockerExecutable);
  requireThat(executable.isFile() && executable.uid === 0 && (executable.mode & 0o022) === 0, 'Docker可执行文件权限不安全', 10);
  const context = await command(['context', 'inspect', 'default'], { capture: true });
  requireThat(processSucceeded(context), '无法检查本地Docker上下文', 40);
  let contexts;
  try { contexts = JSON.parse(context.stdout); } catch { requireThat(false, 'Docker上下文响应无效', 40); }
  const endpoint = contexts?.[0]?.Endpoints?.docker?.Host;
  requireThat(contexts.length === 1 && endpoint === 'unix:///var/run/docker.sock', '禁止远程Docker或未知Engine', 10);
  const info = await command(['info', '--format', '{{json .}}'], { capture: true });
  requireThat(processSucceeded(info), 'Docker Engine不可用', 40);
  let details;
  try { details = JSON.parse(info.stdout); } catch { requireThat(false, 'Docker Engine响应无效', 40); }
  requireThat(details.OSType === 'linux' && ['x86_64', 'amd64'].includes(details.Architecture), 'Engine平台不匹配', 10);
  requireThat(Array.isArray(details.SecurityOptions) && details.SecurityOptions.some(value => value.startsWith('name=seccomp')), 'Engine缺少seccomp隔离', 10);
  requireThat(details.MemoryLimit === true && details.CpuCfsPeriod === true && details.CpuCfsQuota === true && details.PidsLimit === true, 'Engine无法证明CPU内存或PID限制', 10);
  requireThat(!details.Warnings?.some(value => /No (?:memory|swap limit|cpu cfs|pids)/iu.test(value)), 'Engine资源隔离能力不足', 10);
  const inspected = await command(['image', 'inspect', runtime.image], { capture: true });
  requireThat(processSucceeded(inspected), '固定镜像未预装或无法检查', 40);
  let images;
  try { images = JSON.parse(inspected.stdout); } catch { requireThat(false, '镜像检查响应无效', 40); }
  requireThat(images.length === 1 && images[0].Os === 'linux' && images[0].Architecture === 'amd64', '运行镜像平台不匹配', 10);
  const imageDigest = runtime.image.slice(runtime.image.lastIndexOf('@') + 1);
  requireThat(images[0].RepoDigests?.some(value => value.endsWith(`@${imageDigest}`)), '运行镜像digest不匹配', 10);
  textValue(images[0].Id, 128);
  requireThat(/^sha256:[a-f0-9]{64}$/u.test(images[0].Id), '镜像内容身份无效', 10);
  requireThat(images[0].Id === runtime.imageId && !images[0].Config.Volumes, '镜像内容身份或隐式卷不符合固定输入', 10);
  const imageEnvironment = images[0].Config.Env ?? [];
  requireThat(imageEnvironment.every(value => /^(?:PATH|NODE_VERSION|YARN_VERSION)=/u.test(value)), '镜像包含未审核环境变量', 10);
  return { image: runtime.image, imageId: images[0].Id, nodeVersion: runtime.nodeVersion, dockerVersion: details.ServerVersion, runnerLabel: runtime.runnerLabel };
}

export function dockerCommand(runtime) {
  return (args, options = {}) => boundedProcess(runtime.dockerExecutable, ['--host', 'unix:///var/run/docker.sock', ...args], options);
}
