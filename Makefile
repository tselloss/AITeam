.PHONY: all install test start clean

all: install test

install:
	npm install

test:
	node --test

start:
	npm start

clean:
	rm -rf node_modules app/workspaces
