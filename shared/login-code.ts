/** The login-code email, sent by an instance itself or by sendr.soy on its behalf. */
export function loginCodeEmail(code: string) {
  return {
    subject: `Your Sendr login code: ${code}`,
    text: `Your Sendr login code is ${code}. It expires in 5 minutes.`,
    html: `<p>Your Sendr login code is <strong style="font-size:20px;letter-spacing:2px;">${code}</strong>.</p><p>It expires in 5 minutes. If you didn't try to sign in, ignore this email.</p>`,
  }
}

export const LOGIN_CODE_PATTERN = /^\d{6}$/
