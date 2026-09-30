/** Check again after awaited work; a changed operator must start a new action. */
export function terminalContext(user) {
  return {id:user?.id??'',character:user?.character?.uuid??user?.character?.id??'',scene:user?.viewedScene??''};
}
export function sameTerminalContext(before,user) {
  const after=terminalContext(user);
  return before.id===after.id&&before.character===after.character&&before.scene===after.scene;
}
