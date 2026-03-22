import crypto from "node:crypto";

import { TestSession, SessionMode } from "./schemas";
import { TestStore } from "./store";
import { Robot } from "../robot";

export class SessionManager {
	private activeSessions = new Map<string, TestSession>();

	constructor(private store: TestStore) {}

	async startSession(opts: {
		mode: SessionMode;
		deviceId: string;
		platform: "android" | "ios";
		robot: Robot;
		appPackage?: string;
	}): Promise<TestSession> {
		const existing = this.getActiveSessionForDevice(opts.deviceId);
		if (existing) {
			throw new Error(`Device "${opts.deviceId}" already has an active ${existing.mode} session (${existing.id})`);
		}

		const screenSize = await opts.robot.getScreenSize();

		const session: TestSession = {
			id: crypto.randomUUID(),
			mode: opts.mode,
			deviceId: opts.deviceId,
			platform: opts.platform,
			appPackage: opts.appPackage,
			screenSize,
			startedAt: Date.now(),
			actionCount: 0,
		};

		this.store.createSession(session);
		this.activeSessions.set(session.id, session);
		return session;
	}

	endSession(sessionId: string): TestSession {
		const session = this.activeSessions.get(sessionId);
		if (!session) {
			throw new Error(`No active session found with id "${sessionId}"`);
		}

		session.endedAt = Date.now();
		this.store.updateSession(sessionId, { endedAt: session.endedAt });
		this.activeSessions.delete(sessionId);
		return session;
	}

	getSession(sessionId: string): TestSession | undefined {
		return this.activeSessions.get(sessionId) ?? this.store.getSession(sessionId);
	}

	getActiveSessionForDevice(deviceId: string): TestSession | undefined {
		for (const session of this.activeSessions.values()) {
			if (session.deviceId === deviceId) {
				return session;
			}
		}
		return undefined;
	}

	incrementActionCount(sessionId: string): number {
		const session = this.activeSessions.get(sessionId);
		if (!session) {
			throw new Error(`No active session found with id "${sessionId}"`);
		}
		session.actionCount++;
		this.store.updateSession(sessionId, { actionCount: session.actionCount });
		return session.actionCount;
	}
}
