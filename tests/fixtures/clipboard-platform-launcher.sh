#!/bin/sh
exec "${0%/*}/node" "${0%/*}/closed-node-mock.cjs"
