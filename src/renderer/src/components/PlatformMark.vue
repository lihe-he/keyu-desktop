<script setup lang="ts">
import { platformOf } from '../../../shared/platforms'
import type { PlatformId } from '../../../shared/contracts'
defineProps<{ platform: PlatformId; small?: boolean }>()
</script>
<template><span class="platform-mark" :class="{small}" :style="{'--platform-color':platformOf(platform).color}">{{platformOf(platform).short}}</span></template>
