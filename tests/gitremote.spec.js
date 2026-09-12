/* global describe, it, expect, GitRemote */

describe('gitremote.js - remote URL parsing', function(){
  it('parses plain https URLs', function(){
    expect(GitRemote.parseGitRemote("https://github.com/myuser/expense-vault"))
      .to.deep.equal({ host: "github.com", owner: "myuser", repo: "expense-vault" });
  });

  it('strips .git and extra path segments', function(){
    const r = GitRemote.parseGitRemote("https://github.com/myuser/expense-vault.git");
    expect(r.owner).to.equal("myuser");
    expect(r.repo).to.equal("expense-vault");
    const tree = GitRemote.parseGitRemote("https://github.com/myuser/expense-vault/tree/main");
    expect(tree.repo).to.equal("expense-vault");
  });

  it('parses scp-like ssh remotes', function(){
    expect(GitRemote.parseGitRemote("git@github.com:myuser/expense-vault.git"))
      .to.deep.equal({ host: "github.com", owner: "myuser", repo: "expense-vault" });
  });

  it('parses ssh:// and bare owner/repo shorthand', function(){
    const ssh = GitRemote.parseGitRemote("ssh://git@github.com/myuser/expense-vault.git");
    expect(ssh.owner).to.equal("myuser");
    const short = GitRemote.parseGitRemote("myuser/expense-vault");
    expect(short).to.deep.equal({ host: "github.com", owner: "myuser", repo: "expense-vault" });
  });

  it('rejects garbage', function(){
    expect(GitRemote.parseGitRemote("")).to.equal(null);
    expect(GitRemote.parseGitRemote("not a url at all!!!")).to.equal(null);
    expect(GitRemote.parseGitRemote("https://github.com/onlyowner")).to.equal(null);
  });

  it('flags non-github hosts', function(){
    const r = GitRemote.parseGitRemote("https://gitlab.com/a/b.git");
    expect(r.host).to.equal("gitlab.com");
    expect(GitRemote.isGitHubHost(r.host)).to.equal(false);
    expect(GitRemote.isGitHubHost("github.com")).to.equal(true);
  });
});
