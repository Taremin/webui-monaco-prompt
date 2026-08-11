#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function run(cmd, options = {}) {
    console.log(`> ${cmd}`);
    return execSync(cmd, { cwd: rootDir, stdio: 'inherit', ...options });
}

function getOutput(cmd) {
    return execSync(cmd, { cwd: rootDir, encoding: 'utf-8' }).trim();
}

function getCurrentBranch() {
    return getOutput('git rev-parse --abbrev-ref HEAD');
}

function isGitClean() {
    // -uno で Untracked ファイル (tests/ 以下のスクショやログ等) を無視し、追跡中ファイルの変更のみ確認
    const status = getOutput('git status --porcelain -uno');
    if (!status) return true;

    const lines = status.split('\n').filter(Boolean);
    const criticalChanges = lines.filter(line => {
        const filepath = line.replace(/^[\sA-Z?!]+\s+/, '').replace(/^"/, '').replace(/"$/, '').trim();
        if (filepath.startsWith('comfy/') || filepath.startsWith('dist/') || filepath.startsWith('tests/') || filepath.endsWith('.log') || filepath.endsWith('.png')) {
            return false;
        }
        return true;
    });

    if (criticalChanges.length > 0) {
        console.log('Detected critical uncommitted files:', criticalChanges);
    }

    return criticalChanges.length === 0;
}

function parseVersion(versionStr) {
    const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10)
    };
}

function getNextVersion(currentVersion, bumpType) {
    const parsed = parseVersion(currentVersion);
    if (!parsed) throw new Error(`Invalid current version: ${currentVersion}`);

    if (bumpType === 'major') {
        return `${parsed.major + 1}.0.0`;
    } else if (bumpType === 'minor') {
        return `${parsed.major}.${parsed.minor + 1}.0`;
    } else if (bumpType === 'patch') {
        return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    } else if (parseVersion(bumpType)) {
        return bumpType;
    } else {
        throw new Error(`Invalid bump type or version: "${bumpType}". Use 'patch', 'minor', 'major', or a valid version (x.y.z).`);
    }
}

function updatePyprojectVersion(newVersion) {
    const pyprojectPath = path.join(rootDir, 'pyproject.toml');
    if (!fs.existsSync(pyprojectPath)) return;

    let content = fs.readFileSync(pyprojectPath, 'utf-8');
    const versionRegex = /(^version\s*=\s*")[^"]+(")/m;
    if (versionRegex.test(content)) {
        content = content.replace(versionRegex, `$1${newVersion}$2`);
        fs.writeFileSync(pyprojectPath, content, 'utf-8');
        console.log(`Updated pyproject.toml version to ${newVersion}`);
    } else {
        console.warn(`Warning: 'version' key not found in pyproject.toml`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const bumpType = args[0] || 'patch';

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: npm run release -- [patch | minor | major | x.y.z]

Examples:
  npm run release patch       # 0.3.0 -> 0.3.1
  npm run release minor       # 0.3.0 -> 0.4.0
  npm run release 0.3.5       # Set version to 0.3.5
`);
        process.exit(0);
    }

    const startBranch = getCurrentBranch();
    console.log(`Current branch: ${startBranch}`);

    if (!isGitClean()) {
        console.error(`Error: Uncommitted changes detected in working directory. Please commit or stash them first.`);
        process.exit(1);
    }

    // ビルド成果物 (comfy/) の既知の差分を事前にリセット
    try {
        run(`git checkout HEAD -- comfy/`);
    } catch (e) {}

    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;
    const newVersion = getNextVersion(currentVersion, bumpType);
    const tagName = `v${newVersion}`;
    const releaseBranch = `release/${tagName}`;

    console.log(`\n🚀 Starting release process: v${currentVersion} -> ${tagName}\n`);

    try {
        // 1. リリースブランチの作成
        run(`git checkout -b ${releaseBranch}`);

        // 2. バージョンの同期 (package.json & package-lock.json)
        run(`npm version ${newVersion} --no-git-tag-version`);

        // 3. pyproject.toml のバージョン同期
        updatePyprojectVersion(newVersion);

        // 4. プロジェクトのビルド
        console.log(`\n📦 Building project...`);
        run(`npm run build`);

        // 5. 変更内容をコミット
        console.log(`\n📝 Committing release changes...`);
        run(`git add package.json package-lock.json pyproject.toml comfy/`);
        run(`git commit -m "bump: version ${newVersion}"`);

        // 6. master へマージ＆タグ付け
        console.log(`\n🔀 Merging to master and tagging...`);
        run(`git checkout master`);
        run(`git merge --no-ff ${releaseBranch} -m "Merge branch '${releaseBranch}'"`);
        run(`git tag -a ${tagName} -m "Release ${tagName}"`);

        // 7. develop へマージして復帰
        console.log(`\n↩️ Returning to ${startBranch} branch...`);
        run(`git checkout ${startBranch}`);
        run(`git merge --no-ff master -m "Merge branch 'master' into ${startBranch}"`);

        // 8. 一時リリースブランチの削除
        run(`git branch -d ${releaseBranch}`);

        console.log(`\n✅ Release ${tagName} completed successfully!`);
        console.log(`Currently on branch: ${getCurrentBranch()}`);
        console.log(`\nNext step to push changes and tags:`);
        console.log(`  git push origin master ${startBranch} --tags\n`);

    } catch (error) {
        console.error(`\n❌ Release failed with error:`, error.message);
        console.log(`\nCleaning up and returning to ${startBranch}...`);
        try {
            run(`git checkout ${startBranch}`);
            const branches = getOutput('git branch');
            if (branches.includes(releaseBranch)) {
                run(`git branch -D ${releaseBranch}`);
            }
        } catch (cleanupError) {
            console.error(`Cleanup failed:`, cleanupError.message);
        }
        process.exit(1);
    }
}

main();
