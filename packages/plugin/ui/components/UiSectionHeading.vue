<!--
  Small uppercase label above a group of rows. Deliberately carries no margin: spacing differs per
  slot, and passing a conflicting `mb-*` through the class fallthrough would be decided by Tailwind's
  own rule order rather than by the caller.
-->
<template>
  <p class="text-meta font-medium tracking-wide text-dim uppercase">
    <slot />
  </p>
</template>
