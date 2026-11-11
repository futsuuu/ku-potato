package main

import (
	"os"
	"os/exec"
	"strings"
)

func main() {
	goPlugin := tool("protoc-gen-go")
	grpcPlugin := tool("protoc-gen-go-grpc")
	generate(goPlugin, grpcPlugin, "browser-worker/protocol", "worker.proto")
	generate(goPlugin, grpcPlugin, "user-browser/protocol", "user_browser.proto")
}

func generate(goPlugin, grpcPlugin, directory, source string) {
	command := exec.Command(
		"protoc",
		"-I",
		directory,
		"--plugin=protoc-gen-go="+goPlugin,
		"--plugin=protoc-gen-go-grpc="+grpcPlugin,
		"--go_out="+directory,
		"--go_opt=paths=source_relative",
		"--go-grpc_out="+directory,
		"--go-grpc_opt=paths=source_relative",
		source,
	)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		panic(err)
	}
}

func tool(name string) string {
	output, err := exec.Command("go", "tool", "-n", name).Output()
	if err != nil {
		panic(err)
	}
	return strings.TrimSpace(string(output))
}
