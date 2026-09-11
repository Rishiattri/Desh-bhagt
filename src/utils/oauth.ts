export type OAuthPopupSession = {
  locked: true
  provider: 'github'
  startedAt: number
}

export let oauthPopupSession: OAuthPopupSession | null = null

export function openOAuthPopup(url: string) {
  const popup = window.open(
    url,
    'oauth-popup',
    'width=500,height=600'
  )

  if (!popup) {
    oauthPopupSession = null
    return popup
  }

  oauthPopupSession = {
    locked: true,
    provider: 'github',
    startedAt: Date.now(),
  }

  const checkPopup = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(checkPopup)
      oauthPopupSession = null
    }
  }, 500)

  return popup
}