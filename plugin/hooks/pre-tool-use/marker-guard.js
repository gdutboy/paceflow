// Artifact mutation and marker helpers for PreToolUse.
const paceUtils = require('../pace-utils');

const { FORMAT_SNIPPETS } = paceUtils;

function isArtifactWriterManagedRel(artifactRel) {
  // spec.md is a project facts file maintained by the main session via Edit.
  // Shell writes are still blocked by bash/powershell guards because they skip
  // artifact formatting and line-ending safeguards.
  return !!artifactRel && artifactRel !== 'spec.md';
}

function directArtifactMutationDenyReason(toolName, artifactRel) {
  return [
    `禁止主 session/非 artifact-writer 使用 ${toolName} 直接修改流程 artifact：${artifactRel}。`,
    FORMAT_SNIPPETS.skillRef,
    'v6 流程 artifact 只能由 paceflow:artifact-writer 通过受保护的 Write/Edit/MultiEdit 路径写入。',
    '请派 artifact-writer 执行 create-chg / update-chg / close-chg / archive-chg / record-finding / record-correction；不要改用 Write/Edit/MultiEdit 或 Bash 绕过。'
  ].join('\n');
}

function isChangeDetailArtifactRel(artifactRel) {
  return /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(String(artifactRel || ''));
}

function detectChangeDetailMarkerMutation({ artifactRel, newString, oldString, content }) {
  const mutationText = newString || content || '';
  const previousText = oldString || '';
  if (!isChangeDetailArtifactRel(artifactRel) || !mutationText) {
    return {
      hasMarkerMutation: false,
      addedApproved: false,
      addedVerified: false,
      setVerifiedDate: false,
    };
  }
  const addedApproved = mutationText.includes('<!-- APPROVED -->') && !previousText.includes('<!-- APPROVED -->');
  const addedVerified = mutationText.includes('<!-- VERIFIED -->') && !previousText.includes('<!-- VERIFIED -->');
  const setVerifiedDate = paceUtils.hasNonNullVerifiedDate(mutationText) &&
    !paceUtils.hasNonNullVerifiedDate(previousText);
  return {
    hasMarkerMutation: addedApproved || addedVerified || setVerifiedDate,
    addedApproved,
    addedVerified,
    setVerifiedDate,
  };
}

function markerMutationDenyReason(mutation) {
  return `禁止主 session 直接写入 ${mutation.addedApproved ? 'APPROVED' : 'VERIFIED/verified-date'} 标志；请派 artifact-writer 执行对应批准或验证/收尾操作，字段格式见 Skill(paceflow:artifact-management)。`;
}

module.exports = {
  isArtifactWriterManagedRel,
  directArtifactMutationDenyReason,
  isChangeDetailArtifactRel,
  detectChangeDetailMarkerMutation,
  markerMutationDenyReason,
};
