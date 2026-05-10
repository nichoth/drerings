import type { SessionUser } from './auth-store.js'

type PaidUser = Pick<SessionUser, 'subscription_status'>

export function isPaid (user:PaidUser|null|undefined):boolean {
    return user?.subscription_status === 'active'
}
