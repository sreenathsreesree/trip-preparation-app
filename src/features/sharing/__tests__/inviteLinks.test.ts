import { buildInviteLinks, invitePathFor, inviteHost, inviteMessage, parseInviteToken } from '../inviteLinks';
import { redirectSystemPath } from '@/app/+native-intent';

const token = 'Zq3_xY-90abcdefGHIJklmn';

describe('invitation links', () => {
  it('builds a two-slash custom-scheme link when no web host is configured', () => {
    const links = buildInviteLinks(token, null);
    expect(links.app).toBe(`tripprep://join/${token}`);
    expect(links.web).toBeNull();
    expect(links.primary).toBe(links.app);
  });

  it('prefers the https link when a host is configured', () => {
    const links = buildInviteLinks(token, 'invite.example.org');
    expect(links.primary).toBe(`https://invite.example.org/join/${token}`);
    const message = inviteMessage('Goa “trip”', links);
    // The https link stands alone on a line so messaging apps linkify it.
    expect(message.split('\n')).toContain(links.web);
    expect(message).toContain(token);
  });

  it('validates the configured host', () => {
    expect(inviteHost('https://Invite.Example.org/')).toBe('invite.example.org');
    expect(inviteHost('not a host')).toBeNull();
    expect(inviteHost('example.org/path')).toBeNull();
  });

  it('parses every link form, including the legacy triple slash and encoded tokens', () => {
    for (const url of [
      `tripprep://join/${token}`,
      `tripprep:///join/${token}`,
      `https://invite.example.org/join/${encodeURIComponent(token)}?opened=1`,
      `intent://join/${token}#Intent;scheme=tripprep;end`,
      `https://invite.example.org/join?t=${token}`,
      `/join/${token}`,
      `  ${token}  `,
      `Join my trip: https://invite.example.org/join/${token}\nthanks`,
    ]) {
      expect(parseInviteToken(url)).toBe(token);
    }
    expect(parseInviteToken('tripprep://join/short')).toBeNull();
    expect(parseInviteToken('https://x.org/join/%E0%A4%A')).toBeNull();
    expect(() => buildInviteLinks('bad token!')).toThrow();
  });

  it('routes incoming invitation links to the join screen and leaves other paths alone', () => {
    expect(invitePathFor(`tripprep:///join/${token}`)).toBe(`/join/${token}`);
    expect(redirectSystemPath({ path: `https://invite.example.org/join/${token}`, initial: true })).toBe(`/join/${token}`);
    expect(redirectSystemPath({ path: '/auth/callback?code=1', initial: false })).toBe('/auth/callback?code=1');
    expect(redirectSystemPath({ path: '/join', initial: false })).toBe('/join');
  });
});
