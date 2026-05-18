import { getDatabase } from '@netlify/database'
import type {
    NodeSavedSession,
    NodeSavedState,
    NodeSavedSessionStore,
    NodeSavedStateStore
} from '@atproto/oauth-client-node'

export const sessionStore:NodeSavedSessionStore = {
    async get (sub:string):Promise<NodeSavedSession|undefined> {
        const db = getDatabase()
        const result = await db.pool.query<{
            session_data:NodeSavedSession;
        }>(
            'SELECT session_data FROM atproto_sessions WHERE sub = $1',
            [sub]
        )

        return result.rows[0]?.session_data
    },

    async set (sub:string, session:NodeSavedSession):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            `
            INSERT INTO atproto_sessions (sub, session_data, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (sub) DO UPDATE
                SET session_data = EXCLUDED.session_data,
                    updated_at = EXCLUDED.updated_at
            `,
            [sub, JSON.stringify(session)]
        )
    },

    async del (sub:string):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            'DELETE FROM atproto_sessions WHERE sub = $1',
            [sub]
        )
    }
}

export const stateStore:NodeSavedStateStore = {
    async get (key:string):Promise<NodeSavedState|undefined> {
        const db = getDatabase()
        const result = await db.pool.query<{
            state_data:NodeSavedState;
        }>(
            'SELECT state_data FROM atproto_oauth_states WHERE state = $1',
            [key]
        )

        return result.rows[0]?.state_data
    },

    async set (key:string, state:NodeSavedState):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            `
            INSERT INTO atproto_oauth_states (state, state_data)
            VALUES ($1, $2)
            ON CONFLICT (state) DO UPDATE
                SET state_data = EXCLUDED.state_data
            `,
            [key, JSON.stringify(state)]
        )
    },

    async del (key:string):Promise<void> {
        const db = getDatabase()
        await db.pool.query(
            'DELETE FROM atproto_oauth_states WHERE state = $1',
            [key]
        )
    }
}
