import React from 'react';
import * as lucideIcons from 'lucide-react';

/** kebab-case → PascalCase */
function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** 根据 Lucide 图标名（kebab-case）返回 React 元素 */
export function renderLucideMenuIcon(iconName: string): React.ReactNode | undefined {
  const pascalName = kebabToPascal(iconName);
  const IconComponent = (lucideIcons as Record<string, any>)[pascalName];
  if (IconComponent) {
    return <IconComponent size={16} />;
  }
  return undefined;
}
