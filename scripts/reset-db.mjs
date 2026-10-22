import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.cwd(), 'data/blog.db');

for (const file of [target, `${target}-journal`, `${target}-shm`, `${target}-wal`]) {
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`removed ${path.relative(process.cwd(), file)}`);
  }
}

console.log('本地数据库已清空，下次启动会重新建表并写入示例内容。');
