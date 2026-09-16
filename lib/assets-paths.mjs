// ASSETS 目录唯一权威定义（供 shop/personality 等模块复用，避免循环依赖）
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')
