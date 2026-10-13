import { loadConfirmedTestConfig } from './explicit-database.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

// Authoritative Acceptance Admin constants
const ACCEPTANCE_ADMIN_ID = '2a565b98-868c-4d8b-821e-fdd9da94dacc';
const ACCEPTANCE_ADMIN_IDENTIFIER = 'admin';
const ACCEPTANCE_WORKSPACE_ID = '5c3bb47c-7566-4784-a262-11ff6cd32cbd';
const CREDENTIAL_FILE = resolve(root, '.env.qa-credentials.local');
const FORBIDDEN_PASSWORDS = new Set([
  '12345678',
  '123456',
  'password',
  'admin',
  'admin123',
  'owner',
]);

/**
 * Robust prompter supporting both interactive TTY (masked/hidden password entry)
 * and non-TTY automation streams without stream corruption or stdin hanging.
 */
class SecurePrompter {
  constructor() {
    this.isTTY = !!process.stdin.isTTY;
    this.pipedLines = [];
    this.lineWaiters = [];
    if (!this.isTTY) {
      this.rl = readline.createInterface({ input: process.stdin });
      this.rl.on('line', (line) => {
        if (this.lineWaiters.length > 0) {
          this.lineWaiters.shift()(line);
        } else {
          this.pipedLines.push(line);
        }
      });
      this.rl.on('close', () => {
        while (this.lineWaiters.length > 0) {
          const waiter = this.lineWaiters.shift();
          if (waiter) waiter('');
        }
      });
    }
  }

  async askVisible(query) {
    if (!this.isTTY) {
      process.stdout.write(query);
      const line =
        this.pipedLines.length > 0
          ? this.pipedLines.shift()
          : await new Promise((res) => this.lineWaiters.push(res));
      process.stdout.write(line + '\n');
      return line.trim();
    }

    return new Promise((resolvePrompt) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(query, (ans) => {
        rl.close();
        resolvePrompt(ans.trim());
      });
    });
  }

  async askHidden(query) {
    if (!this.isTTY) {
      process.stdout.write(query + '\n');
      const line =
        this.pipedLines.length > 0
          ? this.pipedLines.shift()
          : await new Promise((res) => this.lineWaiters.push(res));
      return line.trim();
    }

    return new Promise((resolvePrompt) => {
      process.stdout.write(query);
      const wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = '';
      const onData = (chunk) => {
        const str = chunk.toString();
        for (const char of str) {
          if (char === '\n' || char === '\r' || char === '\u0004') {
            process.stdin.setRawMode(wasRaw);
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolvePrompt(input.trim());
            return;
          } else if (char === '\u0003') {
            process.stdin.setRawMode(wasRaw);
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            process.exit(130);
          } else if (char === '\u0008' || char === '\x7f') {
            input = input.slice(0, -1);
          } else {
            input += char;
          }
        }
      };
      process.stdin.on('data', onData);
    });
  }

  close() {
    if (this.rl) {
      this.rl.close();
    }
  }
}

async function main() {
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { hashPassword, verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );

  const config = loadConfirmedTestConfig();
  let dbName = config.database;
  let dbHost = config.host;
  let dbPort = config.port;

  if (config.connectionString) {
    try {
      const parsedUrl = new URL(config.connectionString);
      dbName = parsedUrl.pathname.replace(/^\//, '');
      dbHost = parsedUrl.hostname;
      dbPort = parsedUrl.port;
    } catch {}
  }

  // Fail-closed database isolation check
  if (dbName !== 'mglite_unified_qa_test') {
    console.error(
      `[LỖI AN TOÀN] Script chỉ được phép chạy trên database QA (mglite_unified_qa_test). Database hiện tại: "${dbName}". Huỷ bỏ.`,
    );
    process.exit(1);
  }

  const pool = createDatabasePool(config);
  const prompter = new SecurePrompter();

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      console.error(
        `[LỖI KẾT NỐI] Không thể kết nối cơ sở dữ liệu QA: ${health.error}`,
      );
      process.exit(1);
    }

    console.log('======================================================');
    console.log('🔐 KHÔI PHỤC QUYỀN TRUY CẬP OWNER — MANAGEMENT LITE');
    console.log('======================================================');
    console.log(
      `Cơ sở dữ liệu : ${dbName} (${dbHost || '127.0.0.1'}:${dbPort || 55499})`,
    );
    console.log(
      `Tài khoản     : ${ACCEPTANCE_ADMIN_IDENTIFIER} (ID: ${ACCEPTANCE_ADMIN_ID})`,
    );
    console.log(`Workspace     : ${ACCEPTANCE_WORKSPACE_ID} (Role: owner)`);
    console.log('======================================================\n');

    // 1. Explicit Owner Approval
    const confirm = await prompter.askVisible(
      '❓ Bạn có chắc chắn muốn đặt lại mật khẩu cho Quản trị viên (admin)? (y/N): ',
    );

    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log(
        '\n[HỦY BỎ] Thao tác đã bị hủy theo yêu cầu. Không có thay đổi nào được thực hiện.\n',
      );
      process.exit(0);
    }

    // 2. Private masked password entry
    console.log(
      '\n[BẢO MẬT] Mật khẩu nhập vào sẽ được ẩn hoàn toàn để bảo vệ quyền riêng tư.',
    );
    const password = await prompter.askHidden(
      '🔑 Nhập mật khẩu mới cho Owner: ',
    );

    if (!password) {
      console.error('\n[LỖI] Mật khẩu không được để trống.');
      process.exit(1);
    }

    if (password.length < 8) {
      console.error('\n[LỖI] Mật khẩu phải có độ dài tối thiểu 8 ký tự.');
      process.exit(1);
    }

    if (FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
      console.error(
        '\n[LỖI] Mật khẩu này thuộc danh sách mật khẩu yếu hoặc đã từng bị lộ trước đây. Vui lòng chọn mật khẩu an toàn hơn.',
      );
      process.exit(1);
    }

    const confirmPassword = await prompter.askHidden(
      '🔑 Nhập lại mật khẩu mới để xác nhận: ',
    );

    if (password !== confirmPassword) {
      console.error(
        '\n[LỖI] Mật khẩu xác nhận không khớp. Vui lòng thực hiện lại.',
      );
      process.exit(1);
    }

    // 3. Perform database credential update
    const client = await pool.connect();
    let oldVersion = 0;
    let newVersion = 0;

    try {
      await client.query('BEGIN');

      // Verify user existence and exact ID
      const userRes = await client.query(
        'SELECT id, username_normalized, email_normalized, status FROM users WHERE id = $1;',
        [ACCEPTANCE_ADMIN_ID],
      );

      if (userRes.rows.length === 0) {
        throw new Error(
          `Admin actor ID ${ACCEPTANCE_ADMIN_ID} không tồn tại trong database.`,
        );
      }

      const credRes = await client.query(
        'SELECT credential_version FROM user_credentials WHERE user_id = $1;',
        [ACCEPTANCE_ADMIN_ID],
      );
      oldVersion = credRes.rows[0]?.credential_version || 0;

      // Hash with production Argon2id
      const passwordHash = await hashPassword(password);

      // Update credentials
      const updateRes = await client.query(
        `UPDATE user_credentials
         SET password_hash = $1, credential_version = credential_version + 1, password_changed_at = NOW()
         WHERE user_id = $2
         RETURNING credential_version;`,
        [passwordHash, ACCEPTANCE_ADMIN_ID],
      );
      newVersion = updateRes.rows[0]?.credential_version || oldVersion + 1;

      // Revoke all existing sessions
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL;`,
        [ACCEPTANCE_ADMIN_ID],
      );

      // Record audit event
      await client.query(
        `INSERT INTO audit_events (
          workspace_id, actor_user_id, action, entity_type, entity_id, request_id, metadata_sanitized
        ) VALUES (
          $1, $2, 'auth.password_reset', 'user', $2, 'cli-owner-recovery', $3
        );`,
        [
          ACCEPTANCE_WORKSPACE_ID,
          ACCEPTANCE_ADMIN_ID,
          JSON.stringify({
            resetAt: new Date().toISOString(),
            by: 'owner-local-recovery',
            previousVersion: oldVersion,
            newVersion: newVersion,
          }),
        ],
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // 4. Update .env.qa-credentials.local securely with 0600 mode
    let currentContent = '';
    if (fs.existsSync(CREDENTIAL_FILE)) {
      currentContent = fs.readFileSync(CREDENTIAL_FILE, 'utf8');
    }

    const keyName = 'ADMIN_PASSWORD';
    let keyFound = false;
    const lines = currentContent.split('\n').map((line) => {
      if (line.startsWith(`${keyName}=`)) {
        keyFound = true;
        return `${keyName}="${password}"`;
      }
      return line;
    });

    if (!keyFound) {
      lines.push(`${keyName}="${password}"`);
    }

    fs.writeFileSync(CREDENTIAL_FILE, lines.join('\n'), { mode: 0o600 });
    fs.chmodSync(CREDENTIAL_FILE, 0o600);

    // 5. Offline verification with Argon2id
    const verifyClient = await pool.connect();
    try {
      const verifyRes = await verifyClient.query(
        'SELECT password_hash FROM user_credentials WHERE user_id = $1;',
        [ACCEPTANCE_ADMIN_ID],
      );
      const isHashValid = await verifyPassword(
        password,
        verifyRes.rows[0].password_hash,
      );
      if (!isHashValid) {
        throw new Error(
          'Kiểm tra hash Argon2id offline thất bại. Mật khẩu không khớp hash vừa lưu.',
        );
      }
    } finally {
      verifyClient.release();
    }

    console.log('\n======================================================');
    console.log('✅ KHÔI PHỤC MẬT KHẨU OWNER THÀNH CÔNG');
    console.log('======================================================');
    console.log(`Tài khoản          : ${ACCEPTANCE_ADMIN_IDENTIFIER}`);
    console.log(`Actor ID           : ${ACCEPTANCE_ADMIN_ID}`);
    console.log(
      `Workspace          : ${ACCEPTANCE_WORKSPACE_ID} (Role: owner)`,
    );
    console.log(`Credential Version : ${oldVersion} -> ${newVersion}`);
    console.log(`Lưu trữ cục bộ     : ${CREDENTIAL_FILE} (Quyền hạn 0600)`);
    console.log(`Thu hồi phiên cũ   : Đã thu hồi tất cả session trước đó`);
    console.log(`Xác thực offline   : ĐẠT (Argon2id)`);
    console.log('Chỉ xác minh offline trên database QA đã xác nhận.');
  } finally {
    prompter.close();
    await closeDatabasePool(pool);
  }
}

main().catch((err) => {
  console.error('\n[LỖI QUY TRÌNH]', err.message || err);
  process.exit(1);
});
