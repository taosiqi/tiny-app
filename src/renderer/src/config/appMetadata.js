import packageJson from '../../../../package.json'

export const APP_AUTHOR_EMAIL =
  typeof packageJson.author === 'object' && packageJson.author?.email
    ? packageJson.author.email
    : ''
