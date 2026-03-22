import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { TestStore } from "./store";
import {
	TestSession, TestAction, TestScript, TestScriptStep,
	TestReport, ReportError, ActionType, ActionParams,
	SessionMode, ReportStatus, ElementMatcher, StepAssertion,
} from "./schemas";
import { ScreenElement } from "../robot";

const DEFAULT_DB_DIR = path.join(os.homedir(), ".mobile-mcp");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "testing.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	mode TEXT NOT NULL,
	device_id TEXT NOT NULL,
	platform TEXT NOT NULL,
	app_package TEXT,
	screen_width INTEGER,
	screen_height INTEGER,
	screen_scale REAL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	action_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actions (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id),
	sequence_number INTEGER NOT NULL,
	type TEXT NOT NULL,
	params TEXT NOT NULL,
	timestamp INTEGER NOT NULL,
	duration_ms INTEGER NOT NULL,
	result TEXT NOT NULL,
	error TEXT,
	elements_before TEXT,
	elements_after TEXT,
	screenshot_before_ref TEXT,
	screenshot_after_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_id, sequence_number);

CREATE TABLE IF NOT EXISTS scripts (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	platform TEXT NOT NULL,
	app_package TEXT,
	tags TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
	id TEXT PRIMARY KEY,
	script_id TEXT NOT NULL REFERENCES scripts(id),
	sequence_number INTEGER NOT NULL,
	action_type TEXT NOT NULL,
	params TEXT NOT NULL,
	target_element TEXT,
	assertions TEXT NOT NULL DEFAULT '[]',
	timeout_ms INTEGER NOT NULL DEFAULT 5000,
	delay_after_ms INTEGER NOT NULL DEFAULT 1000,
	wait_for_element TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_script ON steps(script_id, sequence_number);

CREATE TABLE IF NOT EXISTS reports (
	id TEXT PRIMARY KEY,
	mode TEXT NOT NULL,
	script_id TEXT,
	device_id TEXT NOT NULL,
	platform TEXT NOT NULL,
	app_package TEXT,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	status TEXT NOT NULL,
	steps_executed INTEGER NOT NULL DEFAULT 0,
	steps_passed INTEGER NOT NULL DEFAULT 0,
	steps_failed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_errors (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	report_id TEXT NOT NULL REFERENCES reports(id),
	step_number INTEGER NOT NULL,
	action_type TEXT NOT NULL,
	message TEXT NOT NULL,
	screenshot_ref TEXT,
	elements TEXT,
	timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_errors_report ON report_errors(report_id);
`;

export class SqliteStore implements TestStore {
	private db: Database.Database;

	constructor(dbPath?: string) {
		const resolvedPath = dbPath ?? DEFAULT_DB_PATH;

		if (resolvedPath !== ":memory:") {
			const dir = path.dirname(resolvedPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		}

		this.db = new Database(resolvedPath);
		this.db.pragma("journal_mode = WAL");
		this.db.exec(SCHEMA_SQL);
		this.migrate();
	}

	private migrate(): void {
		const columns = this.db.pragma("table_info(steps)") as { name: string }[];
		if (columns.length === 0) {return;}

		if (!columns.some(c => c.name === "delay_after_ms")) {
			this.db.exec("ALTER TABLE steps ADD COLUMN delay_after_ms INTEGER NOT NULL DEFAULT 1000");
		}
		if (!columns.some(c => c.name === "wait_for_element")) {
			this.db.exec("ALTER TABLE steps ADD COLUMN wait_for_element TEXT");
		}
	}

	// --- Sessions ---

	createSession(session: TestSession): void {
		this.db.prepare(`
			INSERT INTO sessions (id, mode, device_id, platform, app_package, screen_width, screen_height, screen_scale, started_at, ended_at, action_count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			session.id, session.mode, session.deviceId, session.platform,
			session.appPackage ?? null,
			session.screenSize?.width ?? null,
			session.screenSize?.height ?? null,
			session.screenSize?.scale ?? null,
			session.startedAt, session.endedAt ?? null, session.actionCount,
		);
	}

	getSession(id: string): TestSession | undefined {
		const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
		return row ? this.rowToSession(row) : undefined;
	}

	updateSession(id: string, patch: Partial<TestSession>): void {
		const sets: string[] = [];
		const vals: any[] = [];

		if (patch.endedAt !== undefined) { sets.push("ended_at = ?"); vals.push(patch.endedAt); }
		if (patch.actionCount !== undefined) { sets.push("action_count = ?"); vals.push(patch.actionCount); }
		if (patch.screenSize !== undefined) {
			sets.push("screen_width = ?", "screen_height = ?", "screen_scale = ?");
			vals.push(patch.screenSize.width, patch.screenSize.height, patch.screenSize.scale);
		}

		if (sets.length === 0) {return;}
		vals.push(id);
		this.db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
	}

	listSessions(limit?: number): TestSession[] {
		const sql = limit
			? "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?"
			: "SELECT * FROM sessions ORDER BY started_at DESC";
		const rows = (limit ? this.db.prepare(sql).all(limit) : this.db.prepare(sql).all()) as any[];
		return rows.map(r => this.rowToSession(r));
	}

	private rowToSession(row: any): TestSession {
		return {
			id: row.id,
			mode: row.mode as SessionMode,
			deviceId: row.device_id,
			platform: row.platform,
			appPackage: row.app_package ?? undefined,
			screenSize: row.screen_width !== null
				? { width: row.screen_width, height: row.screen_height, scale: row.screen_scale }
				: undefined,
			startedAt: row.started_at,
			endedAt: row.ended_at ?? undefined,
			actionCount: row.action_count,
		};
	}

	// --- Actions ---

	createAction(action: TestAction): void {
		this.db.prepare(`
			INSERT INTO actions (id, session_id, sequence_number, type, params, timestamp, duration_ms, result, error, elements_before, elements_after, screenshot_before_ref, screenshot_after_ref)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			action.id, action.sessionId, action.sequenceNumber,
			action.type, JSON.stringify(action.params),
			action.timestamp, action.durationMs,
			action.result, action.error ?? null,
			action.elementsBefore ? JSON.stringify(action.elementsBefore) : null,
			action.elementsAfter ? JSON.stringify(action.elementsAfter) : null,
			action.screenshotBeforeRef ?? null, action.screenshotAfterRef ?? null,
		);
	}

	getActionsForSession(sessionId: string): TestAction[] {
		const rows = this.db.prepare(
			"SELECT * FROM actions WHERE session_id = ? ORDER BY sequence_number"
		).all(sessionId) as any[];
		return rows.map(r => this.rowToAction(r));
	}

	private rowToAction(row: any): TestAction {
		return {
			id: row.id,
			sessionId: row.session_id,
			sequenceNumber: row.sequence_number,
			type: row.type as ActionType,
			params: JSON.parse(row.params) as ActionParams,
			timestamp: row.timestamp,
			durationMs: row.duration_ms,
			result: row.result,
			error: row.error ?? undefined,
			elementsBefore: row.elements_before ? JSON.parse(row.elements_before) as ScreenElement[] : undefined,
			elementsAfter: row.elements_after ? JSON.parse(row.elements_after) as ScreenElement[] : undefined,
			screenshotBeforeRef: row.screenshot_before_ref ?? undefined,
			screenshotAfterRef: row.screenshot_after_ref ?? undefined,
		};
	}

	// --- Scripts ---

	createScript(script: TestScript): void {
		this.db.prepare(`
			INSERT INTO scripts (id, name, description, platform, app_package, tags, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			script.id, script.name, script.description, script.platform,
			script.appPackage ?? null, JSON.stringify(script.tags),
			script.createdAt, script.updatedAt,
		);
	}

	getScript(id: string): TestScript | undefined {
		const row = this.db.prepare("SELECT * FROM scripts WHERE id = ?").get(id) as any;
		return row ? this.rowToScript(row) : undefined;
	}

	updateScript(id: string, patch: Partial<TestScript>): void {
		const sets: string[] = [];
		const vals: any[] = [];

		if (patch.name !== undefined) { sets.push("name = ?"); vals.push(patch.name); }
		if (patch.description !== undefined) { sets.push("description = ?"); vals.push(patch.description); }
		if (patch.tags !== undefined) { sets.push("tags = ?"); vals.push(JSON.stringify(patch.tags)); }
		if (patch.updatedAt !== undefined) { sets.push("updated_at = ?"); vals.push(patch.updatedAt); }

		if (sets.length === 0) {return;}
		vals.push(id);
		this.db.prepare(`UPDATE scripts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
	}

	listScripts(): TestScript[] {
		const rows = this.db.prepare("SELECT * FROM scripts ORDER BY updated_at DESC").all() as any[];
		return rows.map(r => this.rowToScript(r));
	}

	deleteScript(id: string): void {
		this.db.prepare("DELETE FROM steps WHERE script_id = ?").run(id);
		this.db.prepare("DELETE FROM scripts WHERE id = ?").run(id);
	}

	private rowToScript(row: any): TestScript {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			platform: row.platform,
			appPackage: row.app_package ?? undefined,
			tags: JSON.parse(row.tags),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// --- Steps ---

	createStep(step: TestScriptStep): void {
		this.db.prepare(`
			INSERT INTO steps (id, script_id, sequence_number, action_type, params, target_element, assertions, timeout_ms, delay_after_ms, wait_for_element)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			step.id, step.scriptId, step.sequenceNumber,
			step.actionType, JSON.stringify(step.params),
			step.targetElement ? JSON.stringify(step.targetElement) : null,
			JSON.stringify(step.assertions), step.timeoutMs, step.delayAfterMs,
			step.waitForElement ? JSON.stringify(step.waitForElement) : null,
		);
	}

	getStepsForScript(scriptId: string): TestScriptStep[] {
		const rows = this.db.prepare(
			"SELECT * FROM steps WHERE script_id = ? ORDER BY sequence_number"
		).all(scriptId) as any[];
		return rows.map(r => this.rowToStep(r));
	}

	deleteStepsForScript(scriptId: string): void {
		this.db.prepare("DELETE FROM steps WHERE script_id = ?").run(scriptId);
	}

	private rowToStep(row: any): TestScriptStep {
		return {
			id: row.id,
			scriptId: row.script_id,
			sequenceNumber: row.sequence_number,
			actionType: row.action_type as ActionType,
			params: JSON.parse(row.params) as ActionParams,
			targetElement: row.target_element ? JSON.parse(row.target_element) as ElementMatcher : undefined,
			assertions: JSON.parse(row.assertions) as StepAssertion[],
			timeoutMs: row.timeout_ms,
			delayAfterMs: row.delay_after_ms ?? 1000,
			waitForElement: row.wait_for_element ? JSON.parse(row.wait_for_element) as ElementMatcher : undefined,
		};
	}

	// --- Reports ---

	createReport(report: TestReport): void {
		this.db.prepare(`
			INSERT INTO reports (id, mode, script_id, device_id, platform, app_package, started_at, ended_at, status, steps_executed, steps_passed, steps_failed)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			report.id, report.mode, report.scriptId ?? null,
			report.deviceId, report.platform, report.appPackage ?? null,
			report.startedAt, report.endedAt ?? null, report.status,
			report.stepsExecuted, report.stepsPassed, report.stepsFailed,
		);
	}

	getReport(id: string): TestReport | undefined {
		const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as any;
		if (!row) {return undefined;}
		const errors = this.getReportErrors(id);
		return this.rowToReport(row, errors);
	}

	updateReport(id: string, patch: Partial<TestReport>): void {
		const sets: string[] = [];
		const vals: any[] = [];

		if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
		if (patch.endedAt !== undefined) { sets.push("ended_at = ?"); vals.push(patch.endedAt); }
		if (patch.stepsExecuted !== undefined) { sets.push("steps_executed = ?"); vals.push(patch.stepsExecuted); }
		if (patch.stepsPassed !== undefined) { sets.push("steps_passed = ?"); vals.push(patch.stepsPassed); }
		if (patch.stepsFailed !== undefined) { sets.push("steps_failed = ?"); vals.push(patch.stepsFailed); }

		if (sets.length === 0) {return;}
		vals.push(id);
		this.db.prepare(`UPDATE reports SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
	}

	listReports(limit?: number): TestReport[] {
		const sql = limit
			? "SELECT * FROM reports ORDER BY started_at DESC LIMIT ?"
			: "SELECT * FROM reports ORDER BY started_at DESC";
		const rows = (limit ? this.db.prepare(sql).all(limit) : this.db.prepare(sql).all()) as any[];
		return rows.map(r => this.rowToReport(r, []));
	}

	private rowToReport(row: any, errors: ReportError[]): TestReport {
		return {
			id: row.id,
			mode: row.mode,
			scriptId: row.script_id ?? undefined,
			deviceId: row.device_id,
			platform: row.platform,
			appPackage: row.app_package ?? undefined,
			startedAt: row.started_at,
			endedAt: row.ended_at ?? undefined,
			status: row.status as ReportStatus,
			stepsExecuted: row.steps_executed,
			stepsPassed: row.steps_passed,
			stepsFailed: row.steps_failed,
			errors,
		};
	}

	// --- Report Errors ---

	addReportError(reportId: string, error: ReportError): void {
		this.db.prepare(`
			INSERT INTO report_errors (report_id, step_number, action_type, message, screenshot_ref, elements, timestamp)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).run(
			reportId, error.stepNumber, error.actionType,
			error.message, error.screenshotRef ?? null,
			error.elements ? JSON.stringify(error.elements) : null,
			error.timestamp,
		);
	}

	getReportErrors(reportId: string): ReportError[] {
		const rows = this.db.prepare(
			"SELECT * FROM report_errors WHERE report_id = ? ORDER BY step_number"
		).all(reportId) as any[];
		return rows.map(r => ({
			stepNumber: r.step_number,
			actionType: r.action_type as ActionType,
			message: r.message,
			screenshotRef: r.screenshot_ref ?? undefined,
			elements: r.elements ? JSON.parse(r.elements) as ScreenElement[] : undefined,
			timestamp: r.timestamp,
		}));
	}

	// --- Lifecycle ---

	close(): void {
		this.db.close();
	}
}
