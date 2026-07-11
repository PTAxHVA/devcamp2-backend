/**
 * Curated, beginner-friendly descriptions for every MasterTopic, keyed by the
 * slug that `slugify(Topic_Name)` produces in seed-content.ts.
 *
 * Why this file exists: the CSV content source has Topic_Name + section columns
 * but NO topic-description column, so descriptions are authored here as content
 * and written onto MasterTopic by the seeder via $set (so a re-seed backfills
 * topics that were seeded before descriptions existed — same fix the seeder
 * already applies to resourceList).
 *
 * - description:      1-2 sentences shown on the topic detail page.
 * - descriptionShort: one-line tagline used by topic cards and the AI
 *                     suggest/feedback prompts (src/config/ai-prompts.ts).
 *
 * Keep keys in sync with the distinct Topic_Name values in
 * seed-data/frontend-content.csv + seed-data/backend-content.csv. A slug with
 * no entry here seeds an empty description and the seeder logs a warning.
 */
export interface TopicDescription {
  description: string
  descriptionShort: string
}

export const TOPIC_DESCRIPTIONS: Record<string, TopicDescription> = {
  'dev-environment-setup': {
    description:
      "Set up the tools every developer needs: a code editor (VS Code), Node.js, and a terminal you're comfortable in. Getting the environment right now saves hours of debugging later.",
    descriptionShort: 'Install VS Code, Node.js, and your terminal toolkit.',
  },
  'git-github': {
    description:
      "Track every change to your code with Git and back it up on GitHub. You'll learn commits, branches, and pull requests — the workflow every team uses to collaborate without overwriting each other's work.",
    descriptionShort: 'Version control and collaboration with Git and GitHub.',
  },
  'javascript-fundamentals': {
    description:
      'The core of JavaScript: variables, data types, functions, loops, and conditionals. This is the foundation that every website and web app is built on.',
    descriptionShort: 'Variables, functions, loops, and core JavaScript syntax.',
  },
  'javascript-advanced': {
    description:
      'Go beyond the basics with closures, promises, async/await, and the array methods that power real apps. These patterns turn working code into clean, modern JavaScript.',
    descriptionShort: 'Closures, async/await, and modern JavaScript patterns.',
  },
  typescript: {
    description:
      "Add static types to JavaScript so your editor catches bugs before you run the code. You'll learn type annotations, interfaces, and generics used across modern codebases.",
    descriptionShort: 'Typed JavaScript: interfaces, generics, and safer code.',
  },
  html: {
    description:
      'Structure web pages with HTML — headings, links, images, forms, and the semantic tags that make content accessible and search-friendly.',
    descriptionShort: 'Structure web pages with semantic HTML elements.',
  },
  css: {
    description:
      'Style your pages with CSS: colors, spacing, the box model, Flexbox, and Grid. Learn how to turn plain HTML into a responsive, good-looking layout.',
    descriptionShort: 'Style and lay out pages with CSS, Flexbox, and Grid.',
  },
  'tailwind-css': {
    description:
      "Build modern UIs fast with Tailwind's utility-first classes. Style directly in your markup and stay consistent without writing custom CSS for everything.",
    descriptionShort: 'Utility-first styling for fast, consistent UIs.',
  },
  react: {
    description:
      'Build interactive user interfaces from reusable components. Learn JSX, props, state, and hooks — the foundation of the most popular frontend library.',
    descriptionShort: 'Component-based UIs with JSX, props, state, and hooks.',
  },
  'next-js': {
    description:
      'Take React to production with Next.js: file-based routing, server-side rendering, and built-in optimizations for fast, SEO-friendly web apps.',
    descriptionShort: 'Production React with routing and server rendering.',
  },
  'node-js-express': {
    description:
      'Run JavaScript on the server with Node.js and build REST APIs using Express. Learn routing, middleware, and how to handle requests and responses.',
    descriptionShort: 'Server-side JavaScript and REST APIs with Express.',
  },
  'postgresql-with-prisma': {
    description:
      'Store data in a relational database with PostgreSQL and query it type-safely through Prisma. Learn tables, relations, and migrations that keep your schema in sync.',
    descriptionShort: 'Relational data with PostgreSQL and the Prisma ORM.',
  },
  'mongodb-with-mongoose': {
    description:
      'Work with a document database using MongoDB and model your data with Mongoose schemas. Learn how flexible documents differ from rigid SQL tables.',
    descriptionShort: 'Document data modeling with MongoDB and Mongoose.',
  },
  'authentication-authorization': {
    description:
      'Let users sign up and log in securely, then control what each user is allowed to access. Learn password hashing, JWT tokens, and protecting routes by role.',
    descriptionShort: 'Secure login, JWT sessions, and role-based access.',
  },
  vue: {
    description:
      'Vue is a beginner-friendly JavaScript framework for building user interfaces using declarative templates and automatic reactivity. This topic teaches Vue 3 with the Composition API and script setup: reactivity, template directives, components, state, and routing.',
    descriptionShort: 'Build reactive user interfaces with Vue 3 and the Composition API.',
  },
  angular: {
    description:
      'Angular is a TypeScript-based frontend framework by Google for building single-page applications from reusable components, using templates with data binding, dependency injection, and a built-in router.',
    descriptionShort: "Google's TypeScript framework for building component-based web apps.",
  },
  bootstrap: {
    description:
      "Bootstrap is the world's most popular component-based CSS framework: a 12-column responsive grid, ready-made components (buttons, cards, navbars, modals), and utility classes you drop straight into your HTML. It is the styling alternative to Tailwind, favoring prebuilt semantic components over atomic utilities.",
    descriptionShort:
      'Component-based CSS framework with a 12-column grid, prebuilt components, and utilities.',
  },
  'mysql-with-prisma': {
    description:
      'Learn the relational database model with MySQL — tables, SQL CRUD, joins, constraints and indexes — then use it from TypeScript with the Prisma ORM (provider "mysql", migrations, and the Prisma Client).',
    descriptionShort: 'Relational data with MySQL and the Prisma ORM.',
  },
}

/**
 * Resolve the curated description for a topic slug. Returns trimmed strings, or
 * empty strings when the slug has no curated entry yet (the seeder warns and
 * seeds blank rather than throwing).
 */
export function resolveTopicDescription(slug: string): TopicDescription {
  const entry = TOPIC_DESCRIPTIONS[slug]
  return {
    description: (entry?.description ?? '').trim(),
    descriptionShort: (entry?.descriptionShort ?? '').trim(),
  }
}
