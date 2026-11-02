import fs from 'node:fs';
import path from 'node:path';
import type { IssueSeverity } from '../../../../packages/contracts/src/issues.js';

export interface CreateGitHubIssueInput {
  bugCode: string;
  title: string;
  description: string;
  routeTemplate: string;
  severity?: IssueSeverity | undefined;
  metadata?: Record<string, unknown> | undefined;
  geminiSummary?: string | undefined;
  screenshotUrl?: string | undefined;
}

export interface GitHubIssueResult {
  issueNumber: number;
  issueUrl: string;
  isMock?: boolean;
}

export class GitHubSyncService {
  private readonly token: string;
  private readonly repo: string;

  constructor(options: { token?: string; repo?: string } = {}) {
    this.token =
      options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    this.repo =
      options.repo ||
      process.env.GITHUB_REPOSITORY ||
      'truhoaiphuong03/management-lite';
  }

  public isAvailable(): boolean {
    return Boolean(this.token && this.token.trim().length > 0);
  }

  /**
   * Creates a GitHub Issue for a newly reported bug and forwards to Telegram Remote Hub inbox
   */
  async createIssue(input: CreateGitHubIssueInput): Promise<GitHubIssueResult> {
    const formattedTitle = `[${input.bugCode}] ${input.title}`;

    // Forward web bug report to Telegram Remote Hub (.anty-bug-inbox.json) if running on a managed machine
    try {
      const hubInboxPath = path.resolve(
        process.cwd(),
        '../anty-remote-hub/.anty-bug-inbox.json',
      );
      const altInboxPath =
        '/Users/duongbinh/Projects/anty-remote-hub/.anty-bug-inbox.json';
      const targetInbox = fs.existsSync(path.dirname(altInboxPath))
        ? altInboxPath
        : hubInboxPath;
      if (
        fs.existsSync(path.dirname(targetInbox)) &&
        !process.env.NODE_TEST_CONTEXT
      ) {
        let inbox: unknown[] = [];
        if (fs.existsSync(targetInbox)) {
          inbox = JSON.parse(fs.readFileSync(targetInbox, 'utf8'));
          if (!Array.isArray(inbox)) inbox = [];
        }
        inbox.push({
          id: `${input.bugCode}-${Date.now()}`,
          project: this.repo.split('/')[1] || 'management-lite',
          bugCode: input.bugCode,
          title: input.title,
          description: input.description,
          routeTemplate: input.routeTemplate,
          severity: input.severity || 'P2',
          geminiSummary: input.geminiSummary || '',
          createdAt: new Date().toISOString(),
          notified: false,
        });
        fs.writeFileSync(
          targetInbox,
          JSON.stringify(inbox.slice(-50), null, 2),
          'utf8',
        );
      }
    } catch {
      // Never block web bug submission if hub folder is absent
    }

    if (!this.isAvailable()) {
      // Graceful offline fallback
      return {
        issueNumber: 0,
        issueUrl: `https://github.com/${this.repo}/issues?q=${encodeURIComponent(input.bugCode)}`,
        isMock: true,
      };
    }

    const bodySections: string[] = [
      `### 🐛 Báo cáo lỗi ${input.bugCode}`,
      `**Tiêu đề:** ${input.title}`,
      `**Đường dẫn giao diện:** \`${input.routeTemplate}\``,
      `**Mức độ:** \`${input.severity || 'P2'}\``,
      '',
      '#### 📝 Mô tả chi tiết:',
      input.description,
      '',
    ];

    if (input.geminiSummary) {
      bodySections.push(
        '#### 🤖 Phân tích sơ bộ từ Gemini AI:',
        input.geminiSummary,
        '',
      );
    }

    if (input.metadata && Object.keys(input.metadata).length > 0) {
      bodySections.push(
        '#### ⚙️ Thông tin môi trường client:',
        '```json',
        JSON.stringify(input.metadata, null, 2),
        '```',
        '',
      );
    }

    if (input.screenshotUrl) {
      bodySections.push(
        '#### 📸 Ảnh chụp màn hình:',
        input.screenshotUrl.startsWith('data:')
          ? '*(Ảnh base64 đã lưu trữ trong cơ sở dữ liệu)*'
          : `![Screenshot](${input.screenshotUrl})`,
        '',
      );
    }

    bodySections.push(
      '---',
      `*Báo cáo tự động được tạo từ MANAGEMENT LITE Hệ thống Báo lỗi.*`,
    );

    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.repo}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'ManagementLite-BugTracker/1.0',
          },
          body: JSON.stringify({
            title: formattedTitle,
            body: bodySections.join('\n'),
            labels: [
              'bug',
              `severity:${input.severity || 'P2'}`,
              'automated-triage',
            ],
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(
          `[GitHubSync] GitHub API error ${response.status}: ${errorText.slice(0, 150)}`,
        );
        return {
          issueNumber: 0,
          issueUrl: `https://github.com/${this.repo}/issues?q=${encodeURIComponent(input.bugCode)}`,
          isMock: true,
        };
      }

      const data = (await response.json()) as {
        number: number;
        html_url: string;
      };
      return {
        issueNumber: data.number,
        issueUrl: data.html_url,
        isMock: false,
      };
    } catch (err) {
      console.warn('[GitHubSync] Failed to sync issue to GitHub:', err);
      return {
        issueNumber: 0,
        issueUrl: `https://github.com/${this.repo}/issues?q=${encodeURIComponent(input.bugCode)}`,
        isMock: true,
      };
    }
  }

  /**
   * Updates GitHub Issue status (closes on fix, reopens on test failure)
   */
  async updateIssueStatus(
    issueNumber: number,
    state: 'open' | 'closed',
    comment?: string,
  ): Promise<boolean> {
    if (!this.isAvailable() || !issueNumber || issueNumber <= 0) {
      return false;
    }

    try {
      // 1. Post comment if provided
      if (comment) {
        await fetch(
          `https://api.github.com/repos/${this.repo}/issues/${issueNumber}/comments`,
          {
            method: 'POST',
            headers: {
              Authorization: `token ${this.token}`,
              Accept: 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
              'User-Agent': 'ManagementLite-BugTracker/1.0',
            },
            body: JSON.stringify({ body: comment }),
          },
        );
      }

      // 2. Update issue state
      const res = await fetch(
        `https://api.github.com/repos/${this.repo}/issues/${issueNumber}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `token ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'ManagementLite-BugTracker/1.0',
          },
          body: JSON.stringify({
            state,
            state_reason: state === 'closed' ? 'completed' : 'reopened',
          }),
        },
      );

      return res.ok;
    } catch (err) {
      console.warn(
        `[GitHubSync] Failed to update GitHub issue #${issueNumber}:`,
        err,
      );
      return false;
    }
  }
}
