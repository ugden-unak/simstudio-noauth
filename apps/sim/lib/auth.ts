export const auth = {
  api: {
    generateOneTimeToken: async () => ({ token: 'dummy' }),
    verifyOneTimeToken: async () => ({ user: { id: 'guest', email: 'guest@example.com' }, session: {} }),
    getSession: async () => ({ user: { id: 'guest', email: 'guest@example.com' } }),
    signInEmail: async () => ({}),
    signUpEmail: async () => ({}),
    forgetPassword: async () => ({}),
    resetPassword: async () => ({}),
  },
  handler: async () => new Response(''),
}

export async function getSession() {
  return { user: { id: 'guest', email: 'guest@example.com' } }
}

export const signIn = async () => ({})
export const signUp = async () => ({})
